import * as cron from 'node-cron';
import { loadConfig } from './config';
import { OpenRouterService } from './services/openrouter';
import { TelegramService } from './services/telegram';

class CreditMonitor {
  private config = loadConfig();
  private openRouter: OpenRouterService;
  private telegram: TelegramService;
  private lastAlertTime: number = 0;
  private alertCooldownMs = 3600000; // 1 hour cooldown between alerts

  constructor() {
    this.openRouter = new OpenRouterService(this.config.openRouterApiKey);
    this.telegram = new TelegramService(
      this.config.telegramBotToken,
      this.config.telegramChatId
    );
  }

  async initialize(): Promise<void> {
    console.log('🚀 OpenRouter Credit Monitor Starting...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💰 Balance Threshold: $${this.config.balanceThreshold}`);
    console.log(`⏰ Check Interval: ${this.config.checkIntervalMinutes} minutes`);
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

    console.log(`⏰ Scheduled to run every ${this.config.checkIntervalMinutes} minutes`);
    console.log('🔄 Monitor is now running... (Press Ctrl+C to stop)\n');
  }
}

// Main execution
async function main() {
  try {
    const monitor = new CreditMonitor();
    await monitor.initialize();
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
