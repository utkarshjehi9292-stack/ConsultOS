// Claude Agent SDK research provider — the agentic half of the hybrid.
//
// Anthropic runs the agent loop (WebSearch/WebFetch tools) and returns findings.
// We isolate it from any local Claude config (`settingSources: []`), restrict it
// to read-only web tools, cap turns/budget, and ask for a single structured JSON
// blob at the end so the deterministic pipeline can consume findings + sources.
//
// Only used when ANTHROPIC_API_KEY is set; otherwise research falls back to
// Gemini grounding (see research.ts).

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { AGENT } from "../models";
import { extractJsonObject } from "../extract-json";
import type { Citation } from "../schemas";
import { ZERO_USAGE, type Usage } from "../telemetry";

export interface ResearchOutput {
  findings: string;
  citations: Citation[];
  usage: Usage;
  costUsd: number | null;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/** A minimal view of the SDK's final-result message (version-tolerant). */
/** The real Claude Agent SDK final message: `type: "result"` (not "final_result"). */
interface ResultLike {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
}

export async function researchWithAgent(opts: {
  system: string;
  prompt: string;
  maxTurns?: number;
}): Promise<ResearchOutput> {
  const options: Options = {
    model: AGENT.research,
    systemPrompt: opts.system,
    allowedTools: ["WebSearch", "WebFetch"],
    disallowedTools: ["Bash", "Write", "Edit", "Read", "Task", "Glob", "Grep"],
    permissionMode: "bypassPermissions",
    settingSources: [], // ignore local ~/.claude and project CLAUDE.md
    maxTurns: opts.maxTurns ?? 12,
    cwd: process.cwd(),
  };

  let usage: Usage = ZERO_USAGE;
  let costUsd: number | null = null;

  // The final message has type "result" (result text, usage, cost). The CLI can
  // exit non-zero on an API error (e.g. low credit) AFTER delivering it — if we
  // captured a result we use it; otherwise we rethrow so the caller falls back.
  let resultMsg: ResultLike | null = null;
  try {
    for await (const message of query({ prompt: opts.prompt, options })) {
      if ((message as ResultLike).type === "result") resultMsg = message as ResultLike;
    }
  } catch (e) {
    if (!resultMsg) throw e;
  }
  if (!resultMsg) throw new Error("Claude Agent SDK returned no result message.");
  if (resultMsg.is_error) throw new Error(`Claude Agent SDK error: ${resultMsg.result ?? "unknown"}`);

  const finalText = resultMsg.result ?? "";
  const inTok = num(resultMsg.usage?.input_tokens);
  const outTok = num(resultMsg.usage?.output_tokens);
  usage = { inputTokens: inTok, outputTokens: outTok, thoughtTokens: 0, totalTokens: inTok + outTok };
  costUsd = typeof resultMsg.total_cost_usd === "number" ? resultMsg.total_cost_usd : null;

  // The agent is asked to end with a JSON object: { findings, sources: [{url,title,date}] }.
  let findings = finalText;
  let citations: Citation[] = [];
  try {
    const parsed = extractJsonObject(finalText) as {
      findings?: string;
      sources?: Array<{ url?: string; title?: string; date?: string }>;
    };
    if (typeof parsed.findings === "string") findings = parsed.findings;
    if (Array.isArray(parsed.sources)) {
      const seen = new Set<string>();
      for (const s of parsed.sources) {
        if (!s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        citations.push({ url: s.url, title: s.title ?? s.url, publisher: null, date: s.date ?? null });
      }
    }
  } catch {
    // No structured trailer — use the raw text as findings, no citations.
    citations = [];
  }

  return { findings, citations, usage, costUsd };
}
