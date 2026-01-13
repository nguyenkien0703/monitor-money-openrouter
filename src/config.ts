import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  openRouterApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  balanceThreshold: number;
  checkIntervalMinutes: number;
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
  };
}
