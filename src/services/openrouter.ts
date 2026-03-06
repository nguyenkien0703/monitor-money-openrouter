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

  formatBalance(balance: CreditBalance): string {
    return `💰 OpenRouter Credit Balance:
━━━━━━━━━━━━━━━━━━━━
📊 Total Credits: $${balance.totalCredits.toFixed(2)}
📉 Total Usage: $${balance.totalUsage.toFixed(2)}
💵 Remaining: $${balance.remainingBalance.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━`;
  }
}
