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

export function getMemoryDir(cwd: string): string {
  return join(getScalerDir(cwd), "memory");
}

export function getMemoryIndexPath(cwd: string): string {
  return join(getMemoryDir(cwd), "index.json");
}

export function getDebugDir(cwd: string): string {
  return join(getScalerDir(cwd), "debug");
}

export function getDebugFailuresPath(cwd: string): string {
  return join(getDebugDir(cwd), "failures.json");
}

export function getDebugAttemptsPath(cwd: string): string {
  return join(getDebugDir(cwd), "attempts.json");
}

export function getCheckpointsDir(cwd: string): string {
  return join(getScalerDir(cwd), "checkpoints");
}
