import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppState } from './persistence';
import { CreditBalance } from './openrouter';
import { Config } from '../config';

export interface DashboardData {
  state: AppState;
  lastBalance: CreditBalance | null;
  config: Config;
}

export class WebService {
  private app = express();
  private sessionToken = crypto.randomBytes(32).toString('hex');

  constructor(
    private port: number,
    private password: string,
    private getData: () => DashboardData,
  ) {
    this.setupMiddleware();
    this.setupRoutes();
  }

  private parseCookies(header = ''): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try { result[key] = decodeURIComponent(val); } catch { result[key] = val; }
    }
    return result;
  }

  private setupMiddleware(): void {
    this.app.use(express.urlencoded({ extended: false }));

    if (this.password) {
      // Login page
      this.app.get('/login', (req: Request, res: Response) => {
        res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
      });

      // Login submit
      this.app.post('/login', (req: Request, res: Response) => {
        if (req.body.password === this.password) {
          res.setHeader('Set-Cookie', `sid=${this.sessionToken}; HttpOnly; Path=/; Max-Age=604800`);
          res.redirect('/');
        } else {
          res.redirect('/login?error=1');
        }
      });

      // Logout
      this.app.get('/logout', (req: Request, res: Response) => {
        res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
        res.redirect('/login');
      });

      // Auth guard for all other routes
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const cookies = this.parseCookies(req.headers.cookie);
        if (cookies.sid === this.sessionToken) return next();
        res.redirect('/login');
      });
    }

    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }

  private setupRoutes(): void {
    this.app.get('/api/status', (req: Request, res: Response) => {
      const { state, lastBalance, config } = this.getData();
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentMonth = today.slice(0, 7);

      const todayCost = (state.currentDay === today && state.dayStartUsage > 0 && lastBalance)
        ? lastBalance.totalUsage - state.dayStartUsage : null;

      const historySum = Object.entries(state.dailyHistory ?? {})
        .filter(([date]) => date.startsWith(currentMonth) && date !== today)
        .reduce((sum, [, r]) => sum + (r.cost ?? 0), 0);
      const monthlySpend = historySum + (todayCost ?? 0);

      const dayOfMonth = now.getUTCDate();
      const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      const burnRatePerDay = dayOfMonth > 0 ? monthlySpend / dayOfMonth : 0;

      res.json({
        balance: lastBalance,
        today: {
          cost: todayCost,
          requestCount: state.dailyHistory[today]?.requestCount ?? null,
        },
        monthly: {
          spent: monthlySpend,
          budget: config.monthlyBudget,
          projected: burnRatePerDay * daysInMonth,
          burnRatePerDay,
          daysLeft: burnRatePerDay > 0
            ? (config.monthlyBudget - monthlySpend) / burnRatePerDay
            : daysInMonth - dayOfMonth,
          percentage: monthlySpend / config.monthlyBudget * 100,
        },
        topup: {
          count: state.monthlyTopupCount,
          limit: config.monthlyTopupLimit,
        },
        lastUpdated: state.lastCheckTime,
      });
    });

    this.app.get('/api/history', (req: Request, res: Response) => {
      const { state } = this.getData();
      const today = new Date().toISOString().slice(0, 10);
      const daysParam = Number(req.query.days);

      let dates: string[];
      if (daysParam > 0) {
        dates = Array.from({ length: daysParam }, (_, i) => {
          const d = new Date(today + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - i);
          return d.toISOString().slice(0, 10);
        }).reverse();
      } else {
        const currentMonth = today.slice(0, 7);
        dates = Object.keys(state.dailyHistory ?? {})
          .filter(d => d.startsWith(currentMonth))
          .sort();
      }

      const days = dates.map(date => {
        const record = state.dailyHistory?.[date];
        return {
          date,
          cost: record?.cost ?? null,
          requestCount: record?.requestCount ?? null,
          topModels: record?.topModels ?? [],
        };
      });

      res.json({ days });
    });

    this.app.get('/api/models', (req: Request, res: Response) => {
      const { state } = this.getData();
      const today = new Date().toISOString().slice(0, 10);
      const modelMap = new Map<string, { cost: number; requests: number }>();

      for (let i = 1; i <= 7; i++) {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        const record = state.dailyHistory?.[date];
        if (record?.topModels) {
          for (const m of record.topModels) {
            const prev = modelMap.get(m.model) ?? { cost: 0, requests: 0 };
            modelMap.set(m.model, { cost: prev.cost + m.cost, requests: prev.requests + m.requests });
          }
        }
      }

      const models = [...modelMap.entries()]
        .map(([model, s]) => ({ model, ...s }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      res.json({ models });
    });
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`🌐 Web dashboard: http://localhost:${this.port}`);
    });
  }
}
