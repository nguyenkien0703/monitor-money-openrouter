import * as cron from 'node-cron';
import { loadConfig } from './config';
import { OpenRouterService } from './services/openrouter';
import { TelegramService } from './services/telegram';
import { PersistenceService, AppState, DayRecord } from './services/persistence';

class CreditMonitor {
  private config = loadConfig();
  private openRouter: OpenRouterService;
  private telegram: TelegramService;
  private persistence: PersistenceService;
  private state: AppState;
  private lastAlertTime: number = 0;
  private alertCooldownMs = 3600000; // 1 hour cooldown between alerts

  constructor() {
    this.openRouter = new OpenRouterService(this.config.openRouterApiKey);
    this.telegram = new TelegramService(
      this.config.telegramBotToken,
      this.config.telegramChatId
    );
    this.persistence = new PersistenceService(this.config.statePath);
    this.state = this.persistence.loadState();
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

  private async checkBudgets(currentTotalUsage: number): Promise<void> {
    const now = Date.now();
    const today = this.getCurrentDay();
    const currentMonth = this.getCurrentMonth();

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
      const rows: Array<{ date: string; record: DayRecord; isToday: boolean }> = [
        { date: today, record: { cost: todayCost, requestCount: null }, isToday: true },
        ...[1, 2, 3, 4].map(i => ({
          date: getPrevDate(i),
          record: this.state.dailyHistory[getPrevDate(i)] ?? { cost: null, requestCount: null },
          isToday: false,
        })),
      ];

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
      console.log(this.openRouter.formatBalance(balance));

      await this.detectTopup(balance.totalCredits);
      await this.handleDailyTracking(balance.totalUsage);
      await this.checkBudgets(balance.totalUsage);

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
