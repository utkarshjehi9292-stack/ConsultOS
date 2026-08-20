// Persistence helpers (server-only I/O). Keeps SQL out of the orchestrator.

import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./client";
import { analyses, companies, llmCalls, watchlists, watchlistSnapshots } from "./schema";
import type { StoredResult } from "../lib/schemas";
import type { Signal } from "../lib/signals";
import type { CallTelemetry } from "../lib/telemetry";
import type { CompanyInput } from "../prompts/tasks";

export interface SaveInput {
  input: CompanyInput;
  result: StoredResult;
  type: "swot" | "growth" | "memo" | "valuechain" | "competition";
  modelVersion: string;
  lowConfidence: boolean;
  calls: CallTelemetry[];
}

export function saveAnalysis(save: SaveInput): { companyId: string; analysisId: string } {
  const db = getDb();
  const companyId = nanoid(12);
  const analysisId = nanoid(12);
  const now = Date.now();

  db.insert(companies)
    .values({
      id: companyId,
      name: save.result.company.name || save.input.name,
      cin: save.input.cin ?? null,
      website: save.input.website ?? null,
      region: save.input.region ?? null,
      sector: save.result.company.sector ?? null,
      profileJson: JSON.stringify(save.result.company),
      sourcesJson: JSON.stringify(save.result.sources),
      fetchedAt: now,
    })
    .run();

  db.insert(analyses)
    .values({
      id: analysisId,
      companyId,
      type: save.type,
      inputSnapshot: JSON.stringify(save.input),
      outputJson: JSON.stringify(save.result),
      confidenceBand: save.result.confidence.band,
      lowConfidence: save.lowConfidence,
      modelVersion: save.modelVersion,
    })
    .run();

  for (const c of save.calls) {
    db.insert(llmCalls)
      .values({
        analysisId,
        provider: c.provider,
        model: c.model,
        stage: c.stage,
        promptHash: c.promptHash,
        inputTokens: c.usage.inputTokens,
        outputTokens: c.usage.outputTokens,
        thoughtTokens: c.usage.thoughtTokens,
        totalTokens: c.usage.totalTokens,
        costUsd: c.costUsd,
        latencyMs: c.latencyMs,
        attempts: c.attempts,
      })
      .run();
  }

  return { companyId, analysisId };
}

export function getLatestAnalysis(companyId: string): { result: StoredResult; createdAt: number } | null {
  const db = getDb();
  const row = db
    .select()
    .from(analyses)
    .where(eq(analyses.companyId, companyId))
    .orderBy(desc(analyses.createdAt))
    .get();
  if (!row) return null;
  return { result: JSON.parse(row.outputJson) as StoredResult, createdAt: row.createdAt };
}

// --- watchlists --------------------------------------------------------------

export function createWatchlist(input: { companyName: string; cin?: string | null; note?: string | null }): {
  token: string;
} {
  const db = getDb();
  const token = nanoid(12);
  db.insert(watchlists)
    .values({ token, companyName: input.companyName, cin: input.cin ?? null, note: input.note ?? null })
    .run();
  return { token };
}

export function getWatchlist(token: string) {
  return getDb().select().from(watchlists).where(eq(watchlists.token, token)).get();
}

export function latestSnapshot(token: string): { signals: Signal[]; added: Signal[]; createdAt: number } | null {
  const row = getDb()
    .select()
    .from(watchlistSnapshots)
    .where(eq(watchlistSnapshots.watchlistToken, token))
    .orderBy(desc(watchlistSnapshots.createdAt))
    .get();
  if (!row) return null;
  return {
    signals: JSON.parse(row.signalsJson) as Signal[],
    added: JSON.parse(row.addedJson) as Signal[],
    createdAt: row.createdAt,
  };
}

/** Watchlists never run, or last run before `beforeMs` (cadence). */
export function listDueWatchlists(beforeMs: number): Array<{ token: string; companyName: string; cin: string | null }> {
  const db = getDb();
  const beforeSecs = Math.floor(beforeMs / 1000);
  const rows = db
    .select()
    .from(watchlists)
    .where(or(isNull(watchlists.lastRunAt), lt(watchlists.lastRunAt, beforeSecs)))
    .orderBy(asc(watchlists.createdAt))
    .all();
  return rows.map((r) => ({ token: r.token, companyName: r.companyName, cin: r.cin }));
}

export function saveSnapshot(token: string, signals: Signal[], added: Signal[]): void {
  const db = getDb();
  db.insert(watchlistSnapshots)
    .values({ watchlistToken: token, signalsJson: JSON.stringify(signals), addedJson: JSON.stringify(added) })
    .run();
  db.update(watchlists).set({ lastRunAt: Math.floor(Date.now() / 1000) }).where(eq(watchlists.token, token)).run();
}
