import express, { Request, Response } from 'express';
import * as path from 'path';
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

  constructor(
    private port: number,
    private getData: () => DashboardData,
  ) {
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.static(path.join(process.cwd(), 'public')));

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
        topup: { count: state.monthlyTopupCount, limit: config.monthlyTopupLimit },
        dailyBudgetLimit: config.dailyBudgetLimit,
        checkIntervalMinutes: config.checkIntervalMinutes,
        lastUpdated: state.lastCheckTime,
      });
    });

    this.app.get('/api/history', (req: Request, res: Response) => {
      const { state } = this.getData();
      const today = new Date().toISOString().slice(0, 10);
      const daysParam = Number(req.query.days);
      const monthParam = req.query.month ? String(req.query.month) : null;

      let dates: string[];
      if (daysParam > 0) {
        dates = Array.from({ length: daysParam }, (_, i) => {
          const d = new Date(today + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - i);
          return d.toISOString().slice(0, 10);
        }).reverse();
      } else if (monthParam) {
        dates = Object.keys(state.dailyHistory ?? {})
          .filter(d => d.startsWith(monthParam))
          .sort();
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

    this.app.get('/api/alerts', (req: Request, res: Response) => {
      const { state } = this.getData();
      res.json({ alerts: state.recentAlerts ?? [] });
    });
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`🌐 Web dashboard: http://localhost:${this.port}`);
    });
  }
}
