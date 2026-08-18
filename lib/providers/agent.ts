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
interface FinalResultLike {
  type?: string;
  text?: string;
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

  let finalText = "";
  let usage: Usage = ZERO_USAGE;
  let costUsd: number | null = null;

  for await (const message of query({ prompt: opts.prompt, options })) {
    const m = message as FinalResultLike;
    if (m.type === "final_result") {
      finalText = m.text ?? "";
      const inTok = num(m.usage?.input_tokens);
      const outTok = num(m.usage?.output_tokens);
      usage = { inputTokens: inTok, outputTokens: outTok, thoughtTokens: 0, totalTokens: inTok + outTok };
      costUsd = typeof m.total_cost_usd === "number" ? m.total_cost_usd : null;
    }
  }

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
