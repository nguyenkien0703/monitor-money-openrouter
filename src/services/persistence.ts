import * as fs from 'fs';
import * as path from 'path';

export interface ModelStat {
  model: string;
  cost: number;
  requests: number;
}

export interface DayRecord {
  cost: number | null;
  requestCount: number | null;
  topModels?: ModelStat[];
}

export interface AppState {
  previousTotalCredits: number;
  monthlyTopupCount: number;
  currentMonth: string;
  currentDay: string;
  dayStartUsage: number;
  dailyHistory: { [date: string]: DayRecord };
  lastCheckUsage: number;
  lastCheckTime: string;         // ISO string
  monthlyBudgetAlerts: string[]; // e.g. ["2026-03_80", "2026-03_90"]
  dailyBudgetAlertDate: string;  // "YYYY-MM-DD" of last daily alert
  anomalyAlertDate: string;      // "YYYY-MM-DD" of last anomaly alert
  monthlyRecapSent: string;      // "YYYY-MM" of last monthly recap sent
}

const DEFAULT_STATE: AppState = {
  previousTotalCredits: 0,
  monthlyTopupCount: 0,
  currentMonth: '',
  currentDay: '',
  dayStartUsage: 0,
  dailyHistory: {},
  lastCheckUsage: 0,
  lastCheckTime: '',
  monthlyBudgetAlerts: [],
  dailyBudgetAlertDate: '',
  anomalyAlertDate: '',
  monthlyRecapSent: '',
};

export class PersistenceService {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  loadState(): AppState {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as AppState;
      return parsed;
    } catch {
      console.log('ℹ️  No existing state file found, using defaults.');
      return { ...DEFAULT_STATE };
    }
  }

  saveState(state: AppState): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.warn('⚠️  Failed to save state file:', err instanceof Error ? err.message : err);
    }
  }
}
