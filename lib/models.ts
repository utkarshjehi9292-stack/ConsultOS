// Central model registry. Every model ID lives here — never hardcode in a
// prompt or route (CLAUDE.md: "do not hardcode assumptions about model names").
//
// The spec tiers work as: a stronger model for analysis chains, a fast/cheap one
// for extraction & classification. We realize that tiering on Google Gemini
// (AI Studio), verified live against the account's available models:
//   - analysis  → gemini-3.1-pro-preview   (strongest reasoning available)
//   - extract   → gemini-3.7-flash         (fast, cheap, structured extraction)
// Override via env without touching code.

export const GEMINI = {
  analysis: process.env.CONSULTOS_ANALYSIS_MODEL ?? "gemini-3.1-pro-preview",
  extract: process.env.CONSULTOS_EXTRACT_MODEL ?? "gemini-3.7-flash",
  /** Grounded web research (Google Search tool) when Claude Agent SDK is absent. */
  research: process.env.CONSULTOS_RESEARCH_MODEL ?? "gemini-3.7-flash",
} as const;

// Claude Agent SDK (Anthropic) research model — used when ANTHROPIC_API_KEY is set.
export const AGENT = {
  research: process.env.CONSULTOS_AGENT_MODEL ?? "claude-sonnet-5",
} as const;

/** temperature 0 for EXTRACT and DECODE (CLAUDE.md). Gemini accepts it. */
export const DETERMINISTIC_TEMPERATURE = 0;

export type Provider = "gemini" | "claude-agent";

/** Which research provider will actually run, given the environment. */
export function researchProvider(): Provider {
  return process.env.ANTHROPIC_API_KEY ? "claude-agent" : "gemini";
}
