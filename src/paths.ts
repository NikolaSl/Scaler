import { join } from "node:path";

export const SCALER_DIR = ".scaler";

export function getScalerDir(cwd: string): string {
  return join(cwd, SCALER_DIR);
}

export function getStatePath(cwd: string): string {
  return join(getScalerDir(cwd), "state.json");
}

export function getLogsDir(cwd: string): string {
  return join(getScalerDir(cwd), "logs");
}

export function getEventLogPath(cwd: string): string {
  return join(getLogsDir(cwd), "events.jsonl");
}
