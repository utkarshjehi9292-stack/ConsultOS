// Shared telemetry shape. Every model call — Gemini or the Claude Agent SDK —
// produces one of these, logged to the `llm_calls` table (CLAUDE.md: "Log every
// AI call (prompt hash, tokens, latency, cost) from day one").

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning/thinking tokens if the model reports them separately (Gemini: thoughtsTokenCount). */
  thoughtTokens: number;
  totalTokens: number;
}

export interface CallTelemetry {
  provider: "gemini" | "claude-agent";
  model: string;
  stage: string; // "research" | "extract" | "swot" | ...
  promptHash: string; // sha256 of the prompt (never the prompt text — may hold PII)
  usage: Usage;
  costUsd: number | null; // Gemini free tier: null; Agent SDK reports total_cost_usd
  latencyMs: number;
  attempts: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  totalTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
