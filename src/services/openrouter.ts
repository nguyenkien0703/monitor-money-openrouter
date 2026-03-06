import axios from 'axios';
import { ModelStat } from './persistence';

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
  ): Promise<Map<string, { cost: number; requestCount: number; topModels: ModelStat[] }> | null> {
    const parseItems = (items: any[]) => {
      const map = new Map<string, { cost: number; requestCount: number; models: Map<string, ModelStat> }>();
      for (const item of items) {
        const date = String(item.date ?? item.created_at ?? '').slice(0, 10);
        if (!date) continue;
        const cost = item.usage ?? 0;
        const requests = item.requests ?? 1;
        const model = item.model_permaslug ?? item.model ?? 'unknown';
        if (!map.has(date)) map.set(date, { cost: 0, requestCount: 0, models: new Map() });
        const day = map.get(date)!;
        day.cost += cost;
        day.requestCount += requests;
        const prev = day.models.get(model) ?? { model, cost: 0, requests: 0 };
        day.models.set(model, { model, cost: prev.cost + cost, requests: prev.requests + requests });
      }
      if (map.size === 0) return null;
      const result = new Map<string, { cost: number; requestCount: number; topModels: ModelStat[] }>();
      for (const [date, day] of map.entries()) {
        const topModels = [...day.models.values()].sort((a, b) => b.cost - a.cost).slice(0, 3);
        result.set(date, { cost: day.cost, requestCount: day.requestCount, topModels });
      }
      return result;
    };

    const endpoints = [
      {
        url: 'https://openrouter.ai/api/internal/v1/transaction-analytics',
        getItems: (data: any) => data?.data?.data ?? data?.data ?? [],
      },
      {
        url: `${this.baseUrl}/activity`,
        getItems: (data: any) => data?.data ?? data ?? [],
      },
    ];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, {
          headers: { 'Authorization': `Bearer ${managementKey}` },
          params: { from: fromISO, to: toISO },
        });
        const items = ep.getItems(res.data);
        if (Array.isArray(items) && items.length > 0) {
          const result = parseItems(items);
          if (result) return result;
        }
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
