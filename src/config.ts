import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  openRouterApiKey: string;
  openRouterManagementKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  balanceThreshold: number;
  checkIntervalMinutes: number;
  monthlyTopupLimit: number;
  statePath: string;
  dailyReportHourUTC: number;
  monthlyBudget: number;        // MONTHLY_BUDGET, e.g. 50
  dailyBudgetLimit: number;     // DAILY_BUDGET_LIMIT, default monthlyBudget/30
  hourlySpikeThreshold: number; // HOURLY_SPIKE_THRESHOLD in $, default 0.5
  anomalyMultiplier: number;    // ANOMALY_MULTIPLIER, alert if today > avg*multiplier, default 2
  perCheckSpikeThreshold: number; // PER_CHECK_SPIKE_THRESHOLD, alert if single check delta > this, default 1
}

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvVarAsNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    openRouterApiKey: getEnvVar('OPENROUTER_API_KEY'),
    telegramBotToken: getEnvVar('TELEGRAM_BOT_TOKEN'),
    telegramChatId: getEnvVar('TELEGRAM_CHAT_ID'),
    balanceThreshold: getEnvVarAsNumber('BALANCE_THRESHOLD', 4),
    checkIntervalMinutes: getEnvVarAsNumber('CHECK_INTERVAL_MINUTES', 30),
    monthlyTopupLimit: getEnvVarAsNumber('MONTHLY_TOPUP_LIMIT', 2),
    openRouterManagementKey: process.env['OPENROUTER_MANAGEMENT_KEY'] || '',
    statePath: process.env['STATE_FILE_PATH'] || './data/state.json',
    dailyReportHourUTC: getEnvVarAsNumber('DAILY_REPORT_HOUR_UTC', 22),
    monthlyBudget: getEnvVarAsNumber('MONTHLY_BUDGET', 50),
    dailyBudgetLimit: getEnvVarAsNumber('DAILY_BUDGET_LIMIT', 50 / 30),
    hourlySpikeThreshold: getEnvVarAsNumber('HOURLY_SPIKE_THRESHOLD', 0.5),
    anomalyMultiplier: getEnvVarAsNumber('ANOMALY_MULTIPLIER', 2),
    perCheckSpikeThreshold: getEnvVarAsNumber('PER_CHECK_SPIKE_THRESHOLD', 1),
  };
}
