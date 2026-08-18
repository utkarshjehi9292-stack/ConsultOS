// Google Gemini (AI Studio) provider — the deterministic analysis engine.
//
// Called over the validated REST contract via fetch (no SDK to guess at). Two
// modes:
//   - generateStructured: JSON-mode (responseMimeType + responseSchema) for the
//     extract → SWOT steps. temperature 0 for determinism (Gemini accepts it).
//   - generateGrounded: Google Search tool for the research fallback; returns
//     text + the retrieved sources as citations. (JSON mode and grounding are
//     mutually exclusive on Gemini, which is exactly why they're separate steps.)

import { createHash } from "node:crypto";
import type { Citation } from "../schemas";
import type { Usage } from "../telemetry";

const BASE =
  process.env.GOOGLE_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryDelayMs: number | null,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

function apiKey(): string {
  const k = process.env.GOOGLE_API_KEY;
  if (!k) throw new GeminiError("GOOGLE_API_KEY is not set.", 401, null);
  return k;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface RawResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; details?: unknown[] };
}

function usageOf(r: RawResponse): Usage {
  const u = r.usageMetadata ?? {};
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtTokens: u.thoughtsTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

function retryDelayMsFrom(details: unknown[] | undefined): number | null {
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    if (
      d &&
      typeof d === "object" &&
      (d as Record<string, unknown>)["@type"]?.toString().includes("RetryInfo")
    ) {
      const rd = (d as Record<string, unknown>).retryDelay;
      if (typeof rd === "string") {
        const secs = parseFloat(rd);
        if (!Number.isNaN(secs)) return Math.round(secs * 1000);
      }
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(model: string, body: unknown, attempt = 0): Promise<RawResponse> {
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as RawResponse;
  if (!res.ok || json.error) {
    const err = json.error;
    const status = err?.code ?? res.status;
    const retryMs = retryDelayMsFrom(err?.details);
    // Transient rate limits (429, with a retry hint) and server overload (503)
    // self-heal — back off (bounded) and retry.
    const transient = (status === 429 && retryMs !== null) || status === 503;
    if (transient && attempt < 3) {
      await sleep(Math.min((retryMs ?? 3000) + 500, 20_000) * (attempt + 1));
      return call(model, body, attempt + 1);
    }
    throw new GeminiError(err?.message ?? `Gemini HTTP ${res.status}`, status, retryMs);
  }
  return json;
}

function firstText(r: RawResponse): string {
  return r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

export interface StructuredResult {
  text: string; // raw JSON text (parse/validate at the call site)
  usage: Usage;
}

/** JSON-mode generation. `responseSchema` is Gemini/OpenAPI-subset schema (guides generation). */
export async function generateStructured(opts: {
  model: string;
  system?: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
}): Promise<StructuredResult> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.responseSchema,
      temperature: opts.temperature ?? 0,
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  const r = await call(opts.model, body);
  return { text: firstText(r), usage: usageOf(r) };
}

export interface GroundedResult {
  text: string;
  citations: Citation[];
  usage: Usage;
}

/** Grounded generation with the Google Search tool. Returns retrieved sources as citations. */
export async function generateGrounded(opts: {
  model: string;
  system?: string;
  prompt: string;
}): Promise<GroundedResult> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    tools: [{ google_search: {} }],
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  const r = await call(opts.model, body);
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const c of chunks) {
    const url = c.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({ url, title: c.web?.title ?? url, publisher: null, date: null });
  }
  return { text: firstText(r), citations, usage: usageOf(r) };
}
