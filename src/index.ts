import * as cron from 'node-cron';
import { loadConfig } from './config';
import { OpenRouterService, CreditBalance } from './services/openrouter';
import { TelegramService } from './services/telegram';
import { PersistenceService, AppState, DayRecord } from './services/persistence';
import { WebService } from './services/web';

class CreditMonitor {
  private config = loadConfig();
  private openRouter: OpenRouterService;
  private telegram: TelegramService;
  private persistence: PersistenceService;
  private state: AppState;
  private lastAlertTime: number = 0;
  private alertCooldownMs = 3600000; // 1 hour cooldown between alerts
  private lastBalance: CreditBalance | null = null;
  private web: WebService;

  constructor() {
    this.openRouter = new OpenRouterService(this.config.openRouterApiKey);
    this.telegram = new TelegramService(
      this.config.telegramBotToken,
      this.config.telegramChatId
    );
    this.persistence = new PersistenceService(this.config.statePath);
    this.state = this.persistence.loadState();
    this.web = new WebService(
      this.config.webPort,
      this.config.webPassword,
      () => ({ state: this.state, lastBalance: this.lastBalance, config: this.config }),
    );
  }

  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private getCurrentDay(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async handleDailyTracking(currentTotalUsage: number): Promise<void> {
    const today = this.getCurrentDay();

    // First run: set baseline
    if (!this.state.currentDay) {
      this.state.currentDay = today;
      this.state.dayStartUsage = currentTotalUsage;
      if (!this.state.dailyHistory) this.state.dailyHistory = {};
      this.persistence.saveState(this.state);
      return;
    }

    // Day has changed: save completed day to history then reset
    if (this.state.currentDay !== today) {
      const yesterdayDate = this.state.currentDay;
      const yesterdayCost = currentTotalUsage - this.state.dayStartUsage;
      if (!this.state.dailyHistory) this.state.dailyHistory = {};
      this.state.dailyHistory[yesterdayDate] = { cost: yesterdayCost, requestCount: null };

      // Keep only last 30 days
      const sortedDates = Object.keys(this.state.dailyHistory).sort();
      if (sortedDates.length > 30) {
        delete this.state.dailyHistory[sortedDates[0]];
      }

      console.log(`📅 Day completed: ${yesterdayDate}, cost=$${yesterdayCost.toFixed(6)}`);

      // Reset for new day
      this.state.currentDay = today;
      this.state.dayStartUsage = currentTotalUsage;
      this.persistence.saveState(this.state);
    }
  }

  private getMonthlySpend(currentTotalUsage: number, today: string, currentMonth: string): number {
    const historySum = Object.entries(this.state.dailyHistory ?? {})
      .filter(([date]) => date.startsWith(currentMonth) && date !== today)
      .reduce((sum, [, r]) => sum + (r.cost ?? 0), 0);
    const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
      ? currentTotalUsage - this.state.dayStartUsage : 0;
    return historySum + todayCost;
  }

  private async detectAnomaly(currentTotalUsage: number): Promise<void> {
    const today = this.getCurrentDay();
    const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
      ? currentTotalUsage - this.state.dayStartUsage : 0;

    if (todayCost <= 0) return;
    if ((this.state.anomalyAlertDate ?? '') === today) return; // already alerted today

    // Gather up to 7 completed days from history
    const past: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const cost = this.state.dailyHistory?.[date]?.cost;
      if (cost !== null && cost !== undefined) past.push(cost);
    }

    if (past.length < 3) return; // not enough data to compare

    const avg = past.reduce((s, c) => s + c, 0) / past.length;
    if (todayCost > avg * this.config.anomalyMultiplier) {
      this.state.anomalyAlertDate = today;
      this.persistence.saveState(this.state);
      console.log(`🚨 Anomaly: today=$${todayCost.toFixed(4)}, avg7d=$${avg.toFixed(4)}`);
      await this.telegram.sendAnomalyAlert(todayCost, avg, this.config.anomalyMultiplier);
    }
  }

  private async sendMonthlyRecap(): Promise<void> {
    const now = new Date();
    // "previous month" = one month before current UTC month
    const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    if ((this.state.monthlyRecapSent ?? '') === prevMonthStr) return;

    const entries = Object.entries(this.state.dailyHistory ?? {})
      .filter(([date]) => date.startsWith(prevMonthStr));

    if (entries.length === 0) return;

    const totalSpent = entries.reduce((s, [, r]) => s + (r.cost ?? 0), 0);
    const totalRequests = entries.every(([, r]) => r.requestCount !== null)
      ? entries.reduce((s, [, r]) => s + (r.requestCount ?? 0), 0)
      : null;
    const avgPerDay = totalSpent / entries.length;
    const topDay = entries.reduce<{ date: string; cost: number } | null>((top, [date, r]) => {
      const c = r.cost ?? 0;
      return !top || c > top.cost ? { date, cost: c } : top;
    }, null);

    this.state.monthlyRecapSent = prevMonthStr;
    this.persistence.saveState(this.state);

    console.log(`📅 Sending monthly recap for ${prevMonthStr}`);
    await this.telegram.sendMonthlyRecap(prevMonthStr, totalSpent, this.config.monthlyBudget, avgPerDay, topDay, totalRequests);
  }

  async sendWeeklyRecap(): Promise<void> {
    try {
      const today = this.getCurrentDay();
      const getDateStr = (daysBack: number) => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - daysBack);
        return d.toISOString().slice(0, 10);
      };

      const sumWeek = (dates: string[]) => {
        let cost = 0, requests = 0, hasAllRequests = true, days = 0;
        for (const date of dates) {
          const r = this.state.dailyHistory?.[date];
          if (r) {
            cost += r.cost ?? 0;
            if (r.requestCount !== null) requests += r.requestCount;
            else hasAllRequests = false;
            days++;
          }
        }
        return { cost, requests: hasAllRequests && days > 0 ? requests : null, days };
      };

      const thisWeek = sumWeek([1,2,3,4,5,6,7].map(getDateStr));
      const lastWeek = sumWeek([8,9,10,11,12,13,14].map(getDateStr));

      console.log(`📊 Sending weekly recap`);
      await this.telegram.sendWeeklyRecap(thisWeek, lastWeek);
    } catch (error) {
      console.error('❌ Weekly recap error:', error instanceof Error ? error.message : error);
    }
  }

  private async handleModelsCommand(): Promise<void> {
    try {
      const today = this.getCurrentDay();
      const modelMap = new Map<string, { cost: number; requests: number }>();
      for (let i = 1; i <= 7; i++) {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        const record = this.state.dailyHistory?.[date];
        if (record?.topModels) {
          for (const m of record.topModels) {
            const prev = modelMap.get(m.model) ?? { cost: 0, requests: 0 };
            modelMap.set(m.model, { cost: prev.cost + m.cost, requests: prev.requests + m.requests });
          }
        }
      }
      const topModels = [...modelMap.entries()]
        .map(([model, s]) => ({ model, ...s }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);
      await this.telegram.sendModelsReport(topModels);
    } catch (error) {
      console.error('❌ /models error:', error instanceof Error ? error.message : error);
    }
  }

  private async handleHistoryCommand(): Promise<void> {
    try {
      const today = this.getCurrentDay();
      const currentMonth = this.getCurrentMonth();
      const balance = await this.openRouter.getCreditBalance();
      const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
        ? balance.totalUsage - this.state.dayStartUsage : null;

      const monthDates = Object.keys(this.state.dailyHistory ?? {})
        .filter(d => d.startsWith(currentMonth) && d !== today)
        .sort();

      const days = [
        ...monthDates.map(date => ({
          date,
          cost: this.state.dailyHistory[date].cost,
          requestCount: this.state.dailyHistory[date].requestCount,
          isToday: false,
        })),
        { date: today, cost: todayCost, requestCount: null, isToday: true },
      ];

      await this.telegram.sendHistoryReport(currentMonth, days);
    } catch (error) {
      console.error('❌ /history error:', error instanceof Error ? error.message : error);
    }
  }

  private startPolling(): void {
    let offset = 0;
    const processedIds = new Set<number>();
    const poll = async () => {
      const updates = await this.telegram.getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (processedIds.has(update.update_id)) continue; // dedup
        processedIds.add(update.update_id);
        if (processedIds.size > 200) {
          const oldest = [...processedIds].slice(0, 100);
          oldest.forEach(id => processedIds.delete(id));
        }
        const text = (update.message?.text ?? '').trim().toLowerCase();
        const chatId = String(update.message?.chat.id ?? '');
        if (chatId !== this.config.telegramChatId) continue; // ignore other chats
        console.log(`📨 Command received: ${text}`);
        if (text === '/status') await this.handleStatusCommand();
        else if (text === '/report') await this.sendDailyReport();
        else if (text === '/budget') await this.handleBudgetCommand();
        else if (text === '/models') await this.handleModelsCommand();
        else if (text === '/history') await this.handleHistoryCommand();
        else if (text === '/help') await this.telegram.sendHelpMessage();
      }
      setTimeout(poll, 1000);
    };
    poll();
    console.log('📨 Telegram command polling started');
  }

  private async handleStatusCommand(): Promise<void> {
    try {
      const balance = await this.openRouter.getCreditBalance();
      const today = this.getCurrentDay();
      const currentMonth = this.getCurrentMonth();
      const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
        ? balance.totalUsage - this.state.dayStartUsage : null;
      const monthlySpend = this.getMonthlySpend(balance.totalUsage, today, currentMonth);
      const dayOfMonth = new Date().getUTCDate();
      const burnRatePerDay = dayOfMonth > 0 ? monthlySpend / dayOfMonth : 0;
      await this.telegram.sendQuickStatus(balance.remainingBalance, todayCost, {
        spent: monthlySpend,
        budget: this.config.monthlyBudget,
        burnRatePerDay,
      });
    } catch (error) {
      console.error('❌ /status error:', error instanceof Error ? error.message : error);
    }
  }

  private async handleBudgetCommand(): Promise<void> {
    try {
      const balance = await this.openRouter.getCreditBalance();
      const today = this.getCurrentDay();
      const currentMonth = this.getCurrentMonth();
      const monthlySpend = this.getMonthlySpend(balance.totalUsage, today, currentMonth);
      const dayOfMonth = new Date().getUTCDate();
      const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
      const burnRatePerDay = dayOfMonth > 0 ? monthlySpend / dayOfMonth : 0;
      const projected = burnRatePerDay * daysInMonth;
      const daysLeft = burnRatePerDay > 0 ? (this.config.monthlyBudget - monthlySpend) / burnRatePerDay : daysInMonth - dayOfMonth;
      await this.telegram.sendBudgetStatus({ spent: monthlySpend, budget: this.config.monthlyBudget, projected, burnRatePerDay, daysLeft });
    } catch (error) {
      console.error('❌ /budget error:', error instanceof Error ? error.message : error);
    }
  }

  private async checkBudgets(currentTotalUsage: number): Promise<void> {
    const now = Date.now();
    const today = this.getCurrentDay();
    const currentMonth = this.getCurrentMonth();

    // 0. Per-check spike detection (absolute delta since last check)
    if (this.state.lastCheckUsage > 0) {
      const checkDelta = currentTotalUsage - this.state.lastCheckUsage;
      const lastSpikeTime = new Date(this.state.perCheckSpikeAlertTime ?? '').getTime() || 0;
      if (checkDelta > this.config.perCheckSpikeThreshold && Date.now() - lastSpikeTime > this.alertCooldownMs) {
        this.state.perCheckSpikeAlertTime = new Date(now).toISOString();
        console.log(`⚡️ Per-check spike: +$${checkDelta.toFixed(4)} since last check`);
        await this.telegram.sendPerCheckSpikeAlert(checkDelta, this.config.checkIntervalMinutes, this.config.perCheckSpikeThreshold);
      }
    }

    // 1. Hourly spike detection
    if (this.state.lastCheckTime && this.state.lastCheckUsage > 0) {
      const timeDeltaHours = (now - new Date(this.state.lastCheckTime).getTime()) / 3600000;
      if (timeDeltaHours > 0) {
        const hourlyRate = (currentTotalUsage - this.state.lastCheckUsage) / timeDeltaHours;
        if (hourlyRate > this.config.hourlySpikeThreshold) {
          console.log(`🚨 Hourly spike: $${hourlyRate.toFixed(3)}/hr (threshold: $${this.config.hourlySpikeThreshold}/hr)`);
          await this.telegram.sendHourlySpikeAlert(hourlyRate, this.config.hourlySpikeThreshold);
        }
      }
    }
    this.state.lastCheckUsage = currentTotalUsage;
    this.state.lastCheckTime = new Date(now).toISOString();

    // 2. Daily budget alert
    const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
      ? currentTotalUsage - this.state.dayStartUsage : 0;
    if (todayCost > this.config.dailyBudgetLimit && this.state.dailyBudgetAlertDate !== today) {
      this.state.dailyBudgetAlertDate = today;
      console.log(`⚠️  Daily budget exceeded: $${todayCost.toFixed(4)} > $${this.config.dailyBudgetLimit.toFixed(4)}`);
      await this.telegram.sendDailyBudgetAlert(todayCost, this.config.dailyBudgetLimit);
    }

    // 3. Monthly budget milestone alerts
    const monthlySpend = this.getMonthlySpend(currentTotalUsage, today, currentMonth);
    const dayOfMonth = new Date().getUTCDate();
    const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
    const burnRatePerDay = dayOfMonth > 0 ? monthlySpend / dayOfMonth : 0;
    const projected = burnRatePerDay * daysInMonth;
    const daysLeft = burnRatePerDay > 0 ? (this.config.monthlyBudget - monthlySpend) / burnRatePerDay : daysInMonth - dayOfMonth;
    const percentage = (monthlySpend / this.config.monthlyBudget) * 100;

    if (!this.state.monthlyBudgetAlerts) this.state.monthlyBudgetAlerts = [];
    for (const threshold of [80, 90, 100]) {
      const key = `${currentMonth}_${threshold}`;
      if (percentage >= threshold && !this.state.monthlyBudgetAlerts.includes(key)) {
        this.state.monthlyBudgetAlerts.push(key);
        console.log(`🔴 Monthly budget ${threshold}%: $${monthlySpend.toFixed(2)} / $${this.config.monthlyBudget}`);
        await this.telegram.sendMonthlyBudgetAlert(threshold, monthlySpend, this.config.monthlyBudget, projected, daysLeft);
      }
    }

    this.persistence.saveState(this.state);
  }

  async sendDailyReport(): Promise<void> {
    try {
      const today = this.getCurrentDay();
      const balance = await this.openRouter.getCreditBalance();

      // Only calculate today's cost if we have a valid baseline for today
      const todayCost = (this.state.currentDay === today && this.state.dayStartUsage > 0)
        ? balance.totalUsage - this.state.dayStartUsage
        : null;

      if (!this.state.dailyHistory) this.state.dailyHistory = {};

      const getPrevDate = (daysBack: number) => {
        const d = new Date(today + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - daysBack);
        return d.toISOString().slice(0, 10);
      };

      // Fetch from API if management key is configured
      if (this.config.openRouterManagementKey) {
        const fromISO = new Date(getPrevDate(4) + 'T00:00:00Z').toISOString();
        const toISO = new Date().toISOString();
        const apiStats = await this.openRouter.fetchDailyStatsByManagementKey(
          this.config.openRouterManagementKey, fromISO, toISO,
        );
        if (apiStats) {
          for (const [date, stats] of apiStats.entries()) {
            this.state.dailyHistory[date] = stats;
          }
          this.persistence.saveState(this.state);
        }
      }

      // Build last 5 days: today (partial) + last 4 completed days
      const todayRequestCount = this.state.dailyHistory[today]?.requestCount ?? null;
      const rawRows = [
        { date: today, record: { cost: todayCost, requestCount: todayRequestCount } as DayRecord, isToday: true },
        ...[1, 2, 3, 4].map(i => ({
          date: getPrevDate(i),
          record: this.state.dailyHistory[getPrevDate(i)] ?? { cost: null, requestCount: null },
          isToday: false,
        })),
      ];

      // Compute trend arrows by comparing each row to the next (older) row
      const rows = rawRows.map((row, i) => {
        const nextCost = rawRows[i + 1]?.record.cost ?? null;
        const thisCost = row.record.cost;
        let trend: '↑' | '↓' | '→' | null = null;
        if (thisCost !== null && nextCost !== null) {
          if (thisCost > nextCost * 1.05) trend = '↑';
          else if (thisCost < nextCost * 0.95) trend = '↓';
          else trend = '→';
        }
        return { ...row, trend };
      });

      // Build monthly stats for report
      const currentMonth = this.getCurrentMonth();
      const monthlySpend = this.getMonthlySpend(balance.totalUsage, today, currentMonth);
      const dayOfMonth = new Date().getUTCDate();
      const daysInMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
      const burnRatePerDay = dayOfMonth > 0 ? monthlySpend / dayOfMonth : 0;
      const monthly = {
        spent: monthlySpend,
        budget: this.config.monthlyBudget,
        projected: burnRatePerDay * daysInMonth,
        burnRatePerDay,
        daysLeft: burnRatePerDay > 0 ? (this.config.monthlyBudget - monthlySpend) / burnRatePerDay : daysInMonth - dayOfMonth,
      };

      await this.telegram.sendDailyReport(rows, monthly);
      console.log(`📊 Daily report sent (${rows.length} days)`);
    } catch (error) {
      console.error('❌ Error sending daily report:', error instanceof Error ? error.message : error);
    }
  }

  private async detectTopup(currentTotalCredits: number): Promise<void> {
    const currentMonth = this.getCurrentMonth();

    // Reset monthly counter when month changes
    if (this.state.currentMonth !== currentMonth) {
      this.state.monthlyTopupCount = 0;
      this.state.currentMonth = currentMonth;
    }

    // First-run guard: just set baseline, do not alert
    if (this.state.previousTotalCredits === 0) {
      console.log('[First run: establishing baseline...]');
      this.state.previousTotalCredits = currentTotalCredits;
      this.persistence.saveState(this.state);
      return;
    }

    const delta = currentTotalCredits - this.state.previousTotalCredits;

    if (delta > 0.001) {
      this.state.monthlyTopupCount += 1;
      this.state.previousTotalCredits = currentTotalCredits;
      const count = this.state.monthlyTopupCount;
      const limit = this.config.monthlyTopupLimit;
      const totalAdded = delta * count; // approximate; delta is the single topup amount

      // Save state before sending Telegram (avoid double-count on restart)
      this.persistence.saveState(this.state);

      console.log(`💰 Auto topup detected! Amount: $${delta.toFixed(2)}, Count this month: ${count}/${limit}`);

      await this.telegram.sendTopupAlert(delta, count, limit);

      if (count > limit) {
        const totalAddedThisMonth = delta * count;
        await this.telegram.sendTopupOverBudgetAlert(count, totalAddedThisMonth, limit);
      }
    } else if (delta < -0.001) {
      // Unexpected decrease – log warning, do not update baseline
      console.warn(`⚠️  Unexpected totalCredits decrease (delta=${delta.toFixed(4)}). Skipping state update.`);
    } else {
      // No topup: update previousTotalCredits to current
      this.state.previousTotalCredits = currentTotalCredits;
      this.persistence.saveState(this.state);
    }
  }

  async initialize(): Promise<void> {
    console.log('🚀 OpenRouter Credit Monitor Starting...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💰 Balance Threshold: $${this.config.balanceThreshold}`);
    console.log(`⏰ Check Interval: ${this.config.checkIntervalMinutes} minutes`);
    console.log(`📊 Monthly Topup Limit: ${this.config.monthlyTopupLimit}x`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test Telegram connection
    const telegramConnected = await this.telegram.testConnection();
    if (!telegramConnected) {
      throw new Error('Failed to connect to Telegram bot. Please check your bot token and chat ID.');
    }

    console.log('✅ All services connected successfully\n');
  }

  async checkBalance(): Promise<void> {
    try {
      const timestamp = new Date().toLocaleString();
      console.log(`[${timestamp}] 🔍 Checking OpenRouter balance...`);

      const balance = await this.openRouter.getCreditBalance();
      this.lastBalance = balance;
      console.log(this.openRouter.formatBalance(balance));

      await this.detectTopup(balance.totalCredits);
      await this.handleDailyTracking(balance.totalUsage);
      await this.checkBudgets(balance.totalUsage);
      await this.detectAnomaly(balance.totalUsage);

      if (balance.remainingBalance < this.config.balanceThreshold) {
        console.log(`\n⚠️  WARNING: Balance below threshold ($${this.config.balanceThreshold})!`);

        // Check cooldown to avoid spamming alerts
        const now = Date.now();
        if (now - this.lastAlertTime > this.alertCooldownMs) {
          await this.telegram.sendLowBalanceAlert(
            balance.remainingBalance,
            this.config.balanceThreshold
          );
          this.lastAlertTime = now;
          console.log('📤 Alert sent to Telegram');
        } else {
          const minutesUntilNextAlert = Math.ceil((this.alertCooldownMs - (now - this.lastAlertTime)) / 60000);
          console.log(`⏳ Alert cooldown active. Next alert possible in ${minutesUntilNextAlert} minutes`);
        }
      } else {
        console.log('✅ Balance is above threshold');
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } catch (error) {
      console.error('❌ Error checking balance:', error instanceof Error ? error.message : error);
    }
  }

  start(): void {
    // Run immediately on start
    this.checkBalance();

    // Schedule periodic checks
    const cronExpression = `*/${this.config.checkIntervalMinutes} * * * *`;
    cron.schedule(cronExpression, () => {
      this.checkBalance();
    });

    // Schedule daily report at configured UTC hour
    const hour = this.config.dailyReportHourUTC;
    cron.schedule(`0 ${hour} * * *`, () => {
      this.sendDailyReport();
    }, { timezone: 'UTC' });

    // Monthly recap on the 1st of each month at 00:05 UTC
    cron.schedule('5 0 1 * *', () => {
      this.sendMonthlyRecap();
    }, { timezone: 'UTC' });

    // Weekly recap every Monday at 08:00 UTC (= 15:00 UTC+7)
    cron.schedule('0 8 * * 1', () => {
      this.sendWeeklyRecap();
    }, { timezone: 'UTC' });

    // Start Telegram command polling
    this.startPolling();

    // Start web dashboard
    this.web.start();

    console.log(`⏰ Scheduled to run every ${this.config.checkIntervalMinutes} minutes`);
    console.log(`📊 Daily report scheduled at ${hour}:00 UTC`);
    console.log('🔄 Monitor is now running... (Press Ctrl+C to stop)\n');
  }
}

// Main execution
async function main() {
  try {
    const monitor = new CreditMonitor();
    await monitor.initialize();

    if (process.argv.includes('--test-report')) {
      console.log('🧪 Test mode: sending daily report now...');
      await monitor.checkBalance(); // establishes today's baseline first
      await monitor.sendDailyReport();
      console.log('✅ Done.');
      process.exit(0);
    }

    monitor.start();
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : error);
    console.error('\n💡 Please check your .env file and ensure all required variables are set correctly.');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down monitor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down monitor...');
  process.exit(0);
});

main();
