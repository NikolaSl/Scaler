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

export function assessToolCallSafety(toolCall: ToolCallLike): SafetyDecision {
  if ((toolCall.toolName === "write" || toolCall.toolName === "edit") && hasProtectedPath(toolCall.input)) {
    return {
      allowed: false,
      risk: "secret",
      reason: "Write/edit targets a protected path.",
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
