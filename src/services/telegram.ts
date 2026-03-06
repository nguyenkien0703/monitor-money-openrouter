import axios from 'axios';
import { DayRecord } from './persistence';

export class TelegramService {
  private botToken: string;
  private chatId: string;
  private baseUrl: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(text: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
      });
      console.log('✅ Telegram notification sent successfully');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.description || error.message;
        throw new Error(`Telegram API error: ${message}`);
      }
      throw error;
    }
  }

  async sendLowBalanceAlert(remainingBalance: number, threshold: number): Promise<void> {
    const message = `⚠️ <b>OpenRouter Credit Alert!</b>

🔴 Your OpenRouter balance is running low!

💵 Current Balance: <b>$${remainingBalance.toFixed(2)}</b>
⚡️ Threshold: $${threshold.toFixed(2)}

Please top-up your account to avoid service interruption.

🕐 Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

    await this.sendMessage(message);
  }

  async sendTopupAlert(amount: number, count: number, limit: number): Promise<void> {
    const totalAdded = amount * count;
    const message = `💰 <b>Auto Topup Detected!</b>

✅ OpenRouter tự động nạp <b>$${amount.toFixed(2)}</b> vào tài khoản.

📊 Topup tháng này: <b>${count}/${limit}</b>
💵 Tổng nạp tháng này: <b>$${totalAdded.toFixed(2)}</b>

🕐 Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

    await this.sendMessage(message);
  }

  async sendTopupOverBudgetAlert(count: number, totalAdded: number, limit: number): Promise<void> {
    const message = `🚨 <b>URGENT: Monthly Topup Limit Exceeded!</b>

⛔️ Auto topup đã xảy ra <b>${count} lần</b> trong tháng này.
📉 Vượt giới hạn cho phép: <b>${limit} lần/tháng</b>.

💸 Tổng đã nạp: <b>$${totalAdded.toFixed(2)}</b>

⚡️ Cần kiểm tra và cân nhắc tắt auto-topup nếu không cần thiết.

🕐 Time: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

    await this.sendMessage(message);
  }

  async sendDailyReport(rows: Array<{ date: string; record: DayRecord; isToday: boolean }>): Promise<void> {
    const formatDate = (d: string) => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y.slice(2)}`;
    };
    const pad = (s: string, len: number) => s.padStart(len);

    const header = `${'Ngày'.padEnd(10)} ${'Requests'.padStart(9)} ${'Cost'.padStart(12)}`;
    const sep = '─'.repeat(header.length);

    const dataLines = rows.map(({ date, record, isToday }) => {
      const dateStr = formatDate(date) + (isToday ? '*' : ' ');
      const req = record.requestCount !== null ? String(record.requestCount) : 'N/A';
      const cost = record.cost !== null ? `$${record.cost.toFixed(4)}` : 'N/A';
      return `${dateStr.padEnd(10)} ${pad(req, 9)} ${pad(cost, 12)}`;
    });

    const knownCosts = rows.map(r => r.record.cost).filter((c): c is number => c !== null);
    const totalCost = knownCosts.length > 0 ? knownCosts.reduce((sum, c) => sum + c, 0) : null;
    const totalCostStr = totalCost !== null ? '$' + totalCost.toFixed(4) : 'N/A';
    const totalLine = `${'Total'.padEnd(10)} ${'N/A'.padStart(9)} ${pad(totalCostStr, 12)}`;

    const table = [header, sep, ...dataLines, sep, totalLine].join('\n');

    const message = `📊 <b>Chi phí 5 ngày gần nhất</b>

<code>${table}</code>

<i>* Hôm nay (đang cập nhật)</i>
🕐 UTC`;

    await this.sendMessage(message);
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/getMe`);
      console.log(`✅ Telegram bot connected: @${response.data.result.username}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Telegram bot');
      return false;
    }
  }
}
