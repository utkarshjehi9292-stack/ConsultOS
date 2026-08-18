// The credibility contract, as Zod schemas. Everything the AI layer produces is
// validated against these before it is stored or shown (CLAUDE.md: "Zod schemas
// for every AI structured output; reject and retry on schema failure").
//
// The non-negotiable that these schemas encode: CITE OR FLAG. Every factual
// claim carries either a source citation or an explicit `assumption` tag. There
// is no third option — a claim with neither is invalid and rejected by VERIFY.

import { z } from "zod";

export const CitationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().nullable().default(null),
  /** ISO date of the source if disclosed; never inferred. */
  date: z.string().nullable().default(null),
});
export type Citation = z.infer<typeof CitationSchema>;

/**
 * Evidence for a single claim. Discriminated on `kind`:
 *   - "citation"   → grounded in a retrieved source (carries the source URL).
 *   - "assumption" → explicitly flagged as unverified; no source exists.
 * There is deliberately no "none" — see VERIFY.
 */
export const EvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("citation"),
    url: z.string().url(),
    title: z.string().min(1),
    /** Optional verbatim snippet from the source that supports the claim. */
    quote: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal("assumption"),
    note: z.string().min(1),
  }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof Confidence>;

/** One structured claim: a statement backed by evidence at a confidence level. */
export const ClaimSchema = z.object({
  statement: z.string().min(1),
  evidence: EvidenceSchema,
  confidence: Confidence,
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Financials are never fabricated. Either explicitly unavailable, or a labeled figure with evidence. */
export const FinancialsSchema = z.union([
  z.object({ status: z.literal("unavailable") }),
  z.object({
    status: z.literal("disclosed"),
    figure: z.string().min(1), // verbatim, e.g. "₹4.2 Cr revenue FY23"
    method: z.string().min(1), // how it was obtained / what it represents
    evidence: EvidenceSchema,
  }),
]);
export type Financials = z.infer<typeof FinancialsSchema>;

/** Company profile — the structured facts about the company (Job 1, Milestone 1). */
export const CompanyProfileSchema = z.object({
  name: z.string().min(1),
  sector: z.string().nullable().default(null),
  /** Plain one-line description, no praise adjectives. */
  oneLiner: z.string().min(1),
  businessModel: z.string().nullable().default(null),
  /** ISO date or year string from a source; null if not disclosed — never inferred. */
  founded: z.string().nullable().default(null),
  hq: z.string().nullable().default(null),
  /** Structured facts, each cited or flagged. */
  facts: z.array(ClaimSchema).default([]),
  financials: FinancialsSchema,
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

/** SWOT — the one analysis type shipped in Milestone 1. Every item cite-or-flag. */
export const SwotSchema = z.object({
  strengths: z.array(ClaimSchema).default([]),
  weaknesses: z.array(ClaimSchema).default([]),
  opportunities: z.array(ClaimSchema).default([]),
  threats: z.array(ClaimSchema).default([]),
});
export type Swot = z.infer<typeof SwotSchema>;

/** Module-level confidence: data coverage and source recency (CLAUDE.md rule 5). */
export const ModuleConfidenceSchema = z.object({
  /** 0–100: share of expected fields that are grounded (not null / not assumption). */
  coveragePct: z.number().min(0).max(100),
  sourceCount: z.number().int().min(0),
  /** Days since the most recent source; null when no dated sources. */
  mostRecentSourceDaysAgo: z.number().int().min(0).nullable(),
  band: Confidence,
});
export type ModuleConfidence = z.infer<typeof ModuleConfidenceSchema>;

/** The stored, verified analysis for one company (readings + facts, kept honest). */
export const AnalysisResultSchema = z.object({
  company: CompanyProfileSchema,
  swot: SwotSchema,
  sources: z.array(CitationSchema).default([]),
  confidence: ModuleConfidenceSchema,
  /** Explicit list of things the analysis could NOT determine (builds trust). */
  notInData: z.array(z.string()).default([]),
  provenance: z.object({
    researchProvider: z.enum(["gemini", "claude-agent"]),
    analysisModel: z.string(),
    extractModel: z.string(),
    generatedAt: z.string(),
  }),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
