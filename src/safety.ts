export type SafetyRiskLevel = "low" | "medium" | "high" | "destructive" | "secret";

export interface SafetyDecision {
  allowed: boolean;
  risk: SafetyRiskLevel;
  reason: string;
  requiresApproval: boolean;
}

export interface ToolCallLike {
  toolName: string;
  input: Record<string, unknown>;
}

export interface SafetyPolicy {
  allowedPathPrefixes?: string[];
}

const protectedPathPatterns = [
  /(^|\/)\.env(\.|$|\/)?/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
];

const protectedCommandPathPatterns = [
  /(^|\s|["'])\.env(\.|\s|$|\/|["'])/i,
  /(^|\s|["'])\.git(\/|\s|$|["'])/i,
  /(^|\s|["'])\.ssh(\/|\s|$|["'])/i,
  /(^|\s|["'])\.aws(\/|\s|$|["'])/i,
  /\S+\.pem(\s|$|["'])/i,
  /\S+\.key(\s|$|["'])/i,
  /\S+\.p12(\s|$|["'])/i,
];

const destructiveCommandPatterns = [
  /\brm\s+[^\n]*(?:-rf|-fr|--recursive)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b[^\n]*\b777\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bkubectl\s+delete\b/i,
];

export function assessToolCallSafety(toolCall: ToolCallLike, policy: SafetyPolicy = {}): SafetyDecision {
  if ((toolCall.toolName === "write" || toolCall.toolName === "edit") && hasProtectedPath(toolCall.input)) {
    return {
      allowed: false,
      risk: "secret",
      reason: "Write/edit targets a protected path.",
      requiresApproval: true,
    };
  }

  if ((toolCall.toolName === "write" || toolCall.toolName === "edit") && !isAllowedPathTarget(toolCall.input, policy.allowedPathPrefixes)) {
    return {
      allowed: false,
      risk: "medium",
      reason: "Write/edit target is outside the current task allowed paths.",
      requiresApproval: true,
    };
  }

  if (toolCall.toolName === "bash") {
    const command = getCommand(toolCall.input);
    if (command && protectedCommandPathPatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "secret",
        reason: "Bash command references a protected path.",
        requiresApproval: true,
      };
    }

    if (command && destructiveCommandPatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "destructive",
        reason: "Bash command matches a destructive or high-risk pattern.",
        requiresApproval: true,
      };
    }
  }

  return {
    allowed: true,
    risk: "low",
    reason: "No safety rule matched.",
    requiresApproval: false,
  };
}

export function shouldBlockWithoutApproval(decision: SafetyDecision): boolean {
  return !decision.allowed && decision.requiresApproval;
}

export function getToolCallTarget(input: Record<string, unknown>): string | undefined {
  const value = input.path ?? input.file_path ?? input.command;
  return typeof value === "string" ? value : undefined;
}

function hasProtectedPath(input: Record<string, unknown>): boolean {
  const target = getToolCallTarget(input);
  if (!target) return false;
  return protectedPathPatterns.some((pattern) => pattern.test(target));
}

function getCommand(input: Record<string, unknown>): string | undefined {
  const command = input.command;
  return typeof command === "string" ? command : undefined;
}

function isAllowedPathTarget(input: Record<string, unknown>, allowedPathPrefixes: string[] | undefined): boolean {
  const prefixes = normalizePathPrefixes(allowedPathPrefixes);
  if (prefixes.length === 0) return true;
  const target = normalizePath(getToolCallTarget(input));
  if (!target) return true;
  return prefixes.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
}

function normalizePathPrefixes(paths: string[] | undefined): string[] {
  return (paths ?? [])
    .map((path) => normalizePath(path))
    .filter((path): path is string => Boolean(path));
}

function normalizePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}
