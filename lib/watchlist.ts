// Watchlist run orchestration (server). Captures recent market signals for a
// company (grounded search → structured extract) and stores the DIFF vs the
// previous snapshot — that diff is the weekly digest.

import { GEMINI } from "./models";
import { generateGrounded, generateStructured } from "./providers/gemini";
import { extractJsonObject } from "./extract-json";
import { diffSignals, geminiSignalsSchema, toSignals, type Signal } from "./signals";
import { signalsExtractTask, signalsSearchTask } from "../prompts/tasks";
import { latestSnapshot, listDueWatchlists, saveSnapshot } from "../db/store";

/** Capture the current signals for a company: grounded search, then structured extract. */
export async function captureSignals(companyName: string): Promise<Signal[]> {
  const searched = await generateGrounded({
    model: GEMINI.research,
    prompt: signalsSearchTask(companyName),
  });
  const extracted = await generateStructured({
    model: GEMINI.extract,
    prompt: signalsExtractTask(companyName, searched.text),
    responseSchema: geminiSignalsSchema,
    temperature: 0,
  });
  return toSignals(extractJsonObject(extracted.text));
}

export interface WatchlistRunResult {
  token: string;
  companyName: string;
  added: Signal[]; // the digest — what's new since last run
  total: number;
  error?: string;
}

/** Run one watchlist: capture, diff against the previous snapshot, persist. */
export async function runWatchlist(token: string, companyName: string): Promise<WatchlistRunResult> {
  try {
    const current = await captureSignals(companyName);
    const prev = latestSnapshot(token)?.signals ?? [];
    const { added } = diffSignals(prev, current);
    saveSnapshot(token, current, added);
    return { token, companyName, added, total: current.length };
  } catch (e) {
    return { token, companyName, added: [], total: 0, error: (e as Error).message };
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Run every watchlist due for a refresh (never run, or older than the cadence). */
export async function runDueWatchlists(cadenceMs = WEEK_MS): Promise<WatchlistRunResult[]> {
  const due = listDueWatchlists(Date.now() - cadenceMs);
  const results: WatchlistRunResult[] = [];
  for (const w of due) {
    results.push(await runWatchlist(w.token, w.companyName)); // sequential — respects rate limits
  }
  return results;
}
