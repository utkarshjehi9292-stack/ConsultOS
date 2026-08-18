// Drizzle schema (SQLite for local dev; Postgres-portable for the Supabase
// target — see README). Milestone 1 subset: companies, analyses, llm_calls.
//
// llm_calls exists from day one (CLAUDE.md) — every model call is logged with
// its prompt hash (never the prompt text: may hold PII), tokens, latency, cost.

import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  cin: text("cin"),
  website: text("website"),
  region: text("region"),
  sector: text("sector"),
  profileJson: text("profile_json").notNull(), // CompanyProfile
  sourcesJson: text("sources_json").notNull(), // Citation[]
  fetchedAt: integer("fetched_at").notNull(),
});

export const analyses = sqliteTable("analyses", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  type: text("type", { enum: ["profile", "swot", "growth", "competition", "valuechain", "memo"] }).notNull(),
  inputSnapshot: text("input_snapshot").notNull(), // CompanyInput
  outputJson: text("output_json").notNull(), // AnalysisResult
  confidenceBand: text("confidence_band", { enum: ["high", "medium", "low"] }).notNull(),
  lowConfidence: integer("low_confidence", { mode: "boolean" }).notNull().default(false),
  /** Prompt + model version fingerprint, for reproducibility. */
  modelVersion: text("model_version").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export const llmCalls = sqliteTable("llm_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisId: text("analysis_id"),
  provider: text("provider").notNull(), // "gemini" | "claude-agent"
  model: text("model").notNull(),
  stage: text("stage").notNull(), // "research" | "extract" | "swot"
  promptHash: text("prompt_hash").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  thoughtTokens: integer("thought_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costUsd: real("cost_usd"),
  latencyMs: integer("latency_ms").notNull().default(0),
  attempts: integer("attempts").notNull().default(1),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

export type CompanyRow = typeof companies.$inferSelect;
export type AnalysisRow = typeof analyses.$inferSelect;
export type LlmCallRow = typeof llmCalls.$inferSelect;
