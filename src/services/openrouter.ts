import axios from 'axios';

export interface CreditBalance {
  totalCredits: number;
  totalUsage: number;
  remainingBalance: number;
}

export class OpenRouterService {
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getCreditBalance(): Promise<CreditBalance> {
    try {
      const response = await axios.get(`${this.baseUrl}/credits`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      // Log raw API response
      console.log('\n📡 OpenRouter API Response:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('');

      const { total_credits, total_usage } = response.data.data;
      const remainingBalance = total_credits - total_usage;

      return {
        totalCredits: total_credits,
        totalUsage: total_usage,
        remainingBalance,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;
        throw new Error(`OpenRouter API error (${status}): ${message}`);
      }
      throw error;
    }
  }

  // Fetch daily aggregated stats using management key
  // Returns map of date (YYYY-MM-DD) → { cost, requestCount }
  async fetchDailyStatsByManagementKey(
    managementKey: string,
    fromISO: string,
    toISO: string,
  ): Promise<Map<string, { cost: number; requestCount: number }> | null> {
    const endpoints = [
      // Internal analytics API (data already aggregated by hour+model)
      {
        url: 'https://openrouter.ai/api/internal/v1/transaction-analytics',
        parse: (data: any) => {
          const items: any[] = data?.data?.data ?? data?.data ?? [];
          const map = new Map<string, { cost: number; requestCount: number }>();
          for (const item of items) {
            const date = String(item.date).slice(0, 10); // "2026-03-06"
            const prev = map.get(date) ?? { cost: 0, requestCount: 0 };
            map.set(date, {
              cost: prev.cost + (item.usage ?? 0),
              requestCount: prev.requestCount + (item.requests ?? 0),
            });
          }
          return map.size > 0 ? map : null;
        },
      },
      // Fallback: public activity API (per-generation list)
      {
        url: `${this.baseUrl}/activity`,
        parse: (data: any) => {
          const items: any[] = data?.data ?? data ?? [];
          if (!Array.isArray(items) || items.length === 0) return null;
          const map = new Map<string, { cost: number; requestCount: number }>();
          for (const item of items) {
            const date = String(item.date ?? item.created_at ?? '').slice(0, 10);
            if (!date) continue;
            const prev = map.get(date) ?? { cost: 0, requestCount: 0 };
            map.set(date, {
              cost: prev.cost + (item.usage ?? 0),
              requestCount: prev.requestCount + (item.requests ?? 1),
            });
          }
          return map.size > 0 ? map : null;
        },
      },
    ];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, {
          headers: { 'Authorization': `Bearer ${managementKey}` },
          params: { from: fromISO, to: toISO },
        });
        const result = ep.parse(res.data);
        if (result) return result;
      } catch (err: any) {
        console.log(`⚠️  ${ep.url}: ${err?.response?.status} ${JSON.stringify(err?.response?.data?.error?.message ?? '').slice(0, 100)}`);
      }
    }
    return null;
  }

  formatBalance(balance: CreditBalance): string {
    return `💰 OpenRouter Credit Balance:
━━━━━━━━━━━━━━━━━━━━
📊 Total Credits: $${balance.totalCredits.toFixed(2)}
📉 Total Usage: $${balance.totalUsage.toFixed(2)}
💵 Remaining: $${balance.remainingBalance.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━`;
  }
}
