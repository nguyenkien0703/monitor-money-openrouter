import * as fs from 'fs';
import * as path from 'path';

export interface AppState {
  previousTotalCredits: number;
  monthlyTopupCount: number;
  currentMonth: string; // format: "YYYY-MM" (UTC)
}

const DEFAULT_STATE: AppState = {
  previousTotalCredits: 0,
  monthlyTopupCount: 0,
  currentMonth: '',
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
