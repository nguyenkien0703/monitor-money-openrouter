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

  private readonly cmdFooter = '\n\n<i>/status · /budget · /report · /models · /history · /help</i>';

  async sendMessage(text: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text + this.cmdFooter,
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

  async sendHourlySpikeAlert(hourlyRate: number, threshold: number): Promise<void> {
    const message = `🚨 <b>Chi phí tăng đột biến!</b>

⚡️ Burn rate hiện tại: <b>$${hourlyRate.toFixed(3)}/giờ</b>
⚠️ Ngưỡng cảnh báo: $${threshold.toFixed(2)}/giờ

Kiểm tra ngay các process đang chạy!
🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendDailyBudgetAlert(todayCost: number, dailyLimit: number): Promise<void> {
    const overPercent = ((todayCost - dailyLimit) / dailyLimit * 100).toFixed(0);
    const message = `⚠️ <b>Vượt ngân sách ngày!</b>

💸 Chi phí hôm nay: <b>$${todayCost.toFixed(4)}</b>
📊 Giới hạn/ngày: $${dailyLimit.toFixed(4)}
📈 Vượt: <b>+${overPercent}%</b>

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendMonthlyBudgetAlert(threshold: number, spent: number, budget: number, projected: number, daysLeft: number): Promise<void> {
    const emoji = threshold >= 100 ? '🚨' : threshold >= 90 ? '🔴' : '🟡';
    const message = `${emoji} <b>Ngân sách tháng ${threshold}%!</b>

💸 Đã dùng: <b>$${spent.toFixed(2)} / $${budget.toFixed(2)}</b>
📈 Dự báo cuối tháng: <b>$${projected.toFixed(2)}</b>
⏳ Còn lại ~${Math.max(0, Math.floor(daysLeft))} ngày trước khi hết budget

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async getUpdates(offset: number): Promise<Array<{ update_id: number; message?: { text: string; chat: { id: string } } }>> {
    try {
      const response = await axios.get(`${this.baseUrl}/getUpdates`, {
        params: { offset, timeout: 25 },
        timeout: 35000,
      });
      return response.data.result ?? [];
    } catch {
      return [];
    }
  }

  async sendQuickStatus(
    remaining: number,
    todayCost: number | null,
    monthly: { spent: number; budget: number; burnRatePerDay: number },
  ): Promise<void> {
    const pct = (monthly.spent / monthly.budget * 100).toFixed(1);
    const todayStr = todayCost !== null ? `$${todayCost.toFixed(4)}` : 'N/A';
    const message = `⚡️ <b>Quick Status</b>

💵 Balance: <b>$${remaining.toFixed(2)}</b>
📊 Hôm nay: <b>${todayStr}</b>
💰 Tháng này: <b>$${monthly.spent.toFixed(2)} / $${monthly.budget.toFixed(2)}</b> (${pct}%)
🔥 Burn rate: $${monthly.burnRatePerDay.toFixed(2)}/ngày

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendBudgetStatus(
    monthly: { spent: number; budget: number; projected: number; burnRatePerDay: number; daysLeft: number },
  ): Promise<void> {
    const pct = (monthly.spent / monthly.budget * 100).toFixed(1);
    const bar = Math.round(Number(pct) / 10);
    const progressBar = '█'.repeat(bar) + '░'.repeat(10 - bar);
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const remaining = Math.max(0, monthly.budget - monthly.spent);
    const message = `💰 <b>Ngân sách ${monthName}</b>

<code>${progressBar} ${pct}%</code>
Đã dùng: <b>$${monthly.spent.toFixed(2)}</b> / $${monthly.budget.toFixed(2)}
Còn lại: <b>$${remaining.toFixed(2)}</b>
Burn rate: $${monthly.burnRatePerDay.toFixed(2)}/ngày
Dự báo cuối tháng: <b>$${monthly.projected.toFixed(2)}</b>
Còn ~${Math.max(0, Math.floor(monthly.daysLeft))} ngày trước khi hết budget

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendAnomalyAlert(todayCost: number, avg7Day: number, multiplier: number): Promise<void> {
    const ratio = (todayCost / avg7Day).toFixed(1);
    const message = `🚨 <b>Chi phí bất thường hôm nay!</b>

📈 Hôm nay: <b>$${todayCost.toFixed(4)}</b>
📊 TB 7 ngày: $${avg7Day.toFixed(4)}
⚠️ Gấp <b>${ratio}x</b> bình thường (ngưỡng: ${multiplier}x)

Kiểm tra ngay các process đang chạy!
🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendMonthlyRecap(
    month: string,
    totalSpent: number,
    budget: number,
    avgPerDay: number,
    topDay: { date: string; cost: number } | null,
    totalRequests: number | null,
  ): Promise<void> {
    const [year, m] = month.split('-');
    const monthLabel = `${m}/${year}`;
    const pct = (totalSpent / budget * 100).toFixed(1);
    const withinBudget = totalSpent <= budget;
    const topDayStr = topDay
      ? `📅 Ngày tốn nhất: ${topDay.date.split('-').reverse().join('/')} ($${topDay.cost.toFixed(4)})`
      : '';
    const reqStr = totalRequests !== null ? `\n📨 Tổng requests: <b>${totalRequests.toLocaleString()}</b>` : '';
    const message = `📅 <b>Tổng kết tháng ${monthLabel}</b>

💸 Tổng chi: <b>$${totalSpent.toFixed(2)}</b> / $${budget.toFixed(2)} (${pct}%)
${withinBudget ? '✅ Trong ngân sách!' : '⚠️ Vượt ngân sách!'}
💡 Trung bình/ngày: $${avgPerDay.toFixed(4)}${reqStr}
${topDayStr}

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendPerCheckSpikeAlert(delta: number, intervalMinutes: number, threshold: number): Promise<void> {
    const message = `⚡️ <b>Chi phí tăng đột biến!</b>

💸 Tăng <b>$${delta.toFixed(4)}</b> trong ${intervalMinutes} phút vừa qua
⚠️ Ngưỡng cảnh báo: $${threshold.toFixed(2)}

Có thể có request đắt tiền đang chạy!
🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendWeeklyRecap(
    thisWeek: { cost: number; requests: number | null; days: number },
    lastWeek: { cost: number; requests: number | null; days: number },
  ): Promise<void> {
    const diff = thisWeek.cost - lastWeek.cost;
    const sign = diff >= 0 ? '+' : '-';
    const diffStr = `${sign}$${Math.abs(diff).toFixed(2)}`;
    const trend = diff > lastWeek.cost * 0.05 ? '📈' : diff < -lastWeek.cost * 0.05 ? '📉' : '➡️';
    const reqStr = thisWeek.requests !== null ? `\n📨 Requests: <b>${thisWeek.requests.toLocaleString()}</b>` : '';
    const lastReqStr = lastWeek.requests !== null ? ` (tuần trước: ${lastWeek.requests.toLocaleString()})` : '';
    const message = `📊 <b>Weekly Recap</b>

7 ngày qua (${thisWeek.days} ngày có data):
💸 Tổng chi: <b>$${thisWeek.cost.toFixed(4)}</b>${reqStr}

So với tuần trước: ${trend} <b>${diffStr}</b>
Tuần trước: $${lastWeek.cost.toFixed(4)}${lastReqStr}

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendModelsReport(models: Array<{ model: string; cost: number; requests: number }>): Promise<void> {
    if (models.length === 0) {
      await this.sendMessage('📭 Chưa có dữ liệu model trong 7 ngày qua.');
      return;
    }
    const lines = models
      .map((m, i) => {
        const name = m.model.split('/')[1] ?? m.model;
        return `${i + 1}. ${name}: <b>$${m.cost.toFixed(4)}</b> (${m.requests.toLocaleString()} req)`;
      })
      .join('\n');
    const message = `🏆 <b>Top Models – 7 ngày qua</b>

${lines}

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendHistoryReport(
    month: string,
    days: Array<{ date: string; cost: number | null; requestCount: number | null; isToday?: boolean }>,
  ): Promise<void> {
    const [year, m] = month.split('-');
    const pad = (s: string, len: number) => s.padStart(len);
    const formatDate = (d: string) => d.split('-').slice(1).reverse().join('/'); // DD/MM

    const header = `${'Ngày'.padEnd(6)} ${'Req'.padStart(6)} ${'Cost'.padStart(12)}`;
    const sep = '─'.repeat(header.length);

    const lines = days.map(({ date, cost, requestCount, isToday }) => {
      const dateStr = formatDate(date) + (isToday ? '*' : ' ');
      const req = requestCount !== null ? String(requestCount) : 'N/A';
      const costStr = cost !== null ? `$${cost.toFixed(4)}` : 'N/A';
      return `${dateStr.padEnd(6)} ${pad(req, 6)} ${pad(costStr, 12)}`;
    });

    const knownCosts = days.map(d => d.cost).filter((c): c is number => c !== null);
    const total = knownCosts.reduce((s, c) => s + c, 0);
    const totalLine = `${'Tot'.padEnd(6)} ${''.padStart(6)} ${pad('$' + total.toFixed(4), 12)}`;

    const table = [header, sep, ...lines, sep, totalLine].join('\n');
    const message = `📅 <b>Lịch sử tháng ${m}/${year}</b>

<code>${table}</code>

🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
    await this.sendMessage(message);
  }

  async sendHelpMessage(): Promise<void> {
    const message = `🤖 <b>OpenRouter Monitor – Lệnh có sẵn</b>

/status – Balance + chi phí hôm nay + % budget
/budget – Chi tiết ngân sách tháng + dự báo
/report – Báo cáo 5 ngày gần nhất
/models – Top models 7 ngày qua
/history – Chi phí từng ngày trong tháng
/help – Danh sách lệnh này`;
    await this.sendMessage(message);
  }

  async sendDailyReport(
    rows: Array<{ date: string; record: DayRecord; isToday: boolean; trend?: '↑' | '↓' | '→' | null }>,
    monthly: { spent: number; budget: number; projected: number; burnRatePerDay: number; daysLeft: number } | null,
  ): Promise<void> {
    const formatDate = (d: string) => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y.slice(2)}`;
    };
    const pad = (s: string, len: number) => s.padStart(len);

    const header = `${'Ngày'.padEnd(10)} ${'Requests'.padStart(9)} ${'Cost'.padStart(12)}`;
    const sep = '─'.repeat(header.length);

    const dataLines = rows.map(({ date, record, isToday, trend }) => {
      const dateStr = formatDate(date) + (isToday ? '*' : ' ');
      const req = record.requestCount !== null ? String(record.requestCount) : 'N/A';
      const cost = record.cost !== null ? `$${record.cost.toFixed(4)}` : 'N/A';
      const trendChar = trend ?? ' ';
      return `${dateStr.padEnd(10)} ${pad(req, 9)} ${pad(cost, 12)}${trendChar}`;
    });

    const knownCosts = rows.map(r => r.record.cost).filter((c): c is number => c !== null);
    const totalCost = knownCosts.length > 0 ? knownCosts.reduce((sum, c) => sum + c, 0) : null;
    const totalCostStr = totalCost !== null ? '$' + totalCost.toFixed(4) : 'N/A';
    const totalLine = `${'Total'.padEnd(10)} ${'N/A'.padStart(9)} ${pad(totalCostStr, 12)}`;

    const table = [header, sep, ...dataLines, sep, totalLine].join('\n');

    // Monthly budget section
    let monthlySection = '';
    if (monthly) {
      const pct = (monthly.spent / monthly.budget * 100).toFixed(1);
      const bar = Math.round(Number(pct) / 10);
      const progressBar = '█'.repeat(bar) + '░'.repeat(10 - bar);
      monthlySection = `

💰 <b>Ngân sách tháng này</b>
<code>${progressBar} ${pct}%</code>
Đã dùng: <b>$${monthly.spent.toFixed(2)}</b> / $${monthly.budget.toFixed(2)}
Burn rate: $${monthly.burnRatePerDay.toFixed(2)}/ngày
Dự báo cuối tháng: <b>$${monthly.projected.toFixed(2)}</b>
Còn ~${Math.max(0, Math.floor(monthly.daysLeft))} ngày trước khi hết budget`;
    }

    // Top models of most recent completed day
    const recentCompleted = rows.find(r => !r.isToday && r.record.topModels && r.record.topModels.length > 0);
    let modelSection = '';
    if (recentCompleted?.record.topModels) {
      const modelLines = recentCompleted.record.topModels
        .map((m, i) => `${i + 1}. ${m.model.split('/')[1] ?? m.model}: <b>$${m.cost.toFixed(4)}</b> (${m.requests} req)`)
        .join('\n');
      modelSection = `

🏆 <b>Top models ${formatDate(recentCompleted.date)}</b>
${modelLines}`;
    }

    const message = `📊 <b>Chi phí 5 ngày gần nhất</b>

<code>${table}</code>

<i>* Hôm nay (đang cập nhật)</i>${monthlySection}${modelSection}
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
