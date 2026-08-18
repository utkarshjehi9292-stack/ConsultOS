// Persistence helpers (server-only I/O). Keeps SQL out of the orchestrator.

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./client";
import { analyses, companies, llmCalls } from "./schema";
import type { AnalysisResult } from "../lib/schemas";
import type { CallTelemetry } from "../lib/telemetry";
import type { CompanyInput } from "../prompts/tasks";

export interface SaveInput {
  input: CompanyInput;
  result: AnalysisResult;
  type: "swot";
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

export function getLatestAnalysis(companyId: string): { result: AnalysisResult; createdAt: number } | null {
  const db = getDb();
  const row = db
    .select()
    .from(analyses)
    .where(eq(analyses.companyId, companyId))
    .orderBy(desc(analyses.createdAt))
    .get();
  if (!row) return null;
  return { result: JSON.parse(row.outputJson) as AnalysisResult, createdAt: row.createdAt };
}
