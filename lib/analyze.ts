// The analysis chain (server-only). Code orchestrates every step; the models
// never decide the control flow. This is the anti-hallucination architecture:
//
//   RESEARCH  → gather sourced findings (Claude Agent SDK, or Gemini grounding)
//   EXTRACT   → structure into a CompanyProfile   (Gemini JSON mode + Zod)
//   SWOT      → the one analysis module in M1      (Gemini JSON mode + Zod)
//   VERIFY    → machine gates (cite-or-flag, no invented sources, no fabricated
//               financials, no hedged high-confidence); sanitize to pass, never
//               ship a defect.
//
// Every step is Zod-validated and retried (max 2) with feedback on failure, and
// every call is logged to llm_calls.

import { GEMINI, AGENT, researchProvider } from "./models";
import { generateGrounded, generateStructured, sha256 } from "./providers/gemini";
import { researchWithAgent } from "./providers/agent";
import { extractJsonObject } from "./extract-json";
import { toCompanyProfile, toSwot, geminiProfileSchema, geminiSwotSchema } from "./wire";
import {
  computeModuleConfidence,
  normalizeUrl,
  verifyAnalysis,
  collectClaims,
} from "./sanity";
import type { AnalysisResult, Citation, CompanyProfile, Swot } from "./schemas";
import { addUsage, ZERO_USAGE, type CallTelemetry, type Usage } from "./telemetry";
import { CONSULTANT_SYSTEM, CONSULTANT_SYSTEM_VERSION } from "../prompts/system";
import {
  EXTRACT_VERSION,
  RESEARCH_VERSION,
  SWOT_VERSION,
  extractTask,
  researchTaskAgent,
  researchTaskGemini,
  swotTask,
  type CompanyInput,
} from "../prompts/tasks";
import { saveAnalysis } from "../db/store";

const MAX_ATTEMPTS = 3; // initial + 2 retries (CLAUDE.md)

export class AnalyzeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeError";
  }
}

// --- RESEARCH ---------------------------------------------------------------

async function research(
  input: CompanyInput,
  calls: CallTelemetry[],
): Promise<{ findings: string; sources: Citation[] }> {
  const t0 = Date.now();
  if (researchProvider() === "claude-agent") {
    const prompt = researchTaskAgent(input);
    const r = await researchWithAgent({ system: CONSULTANT_SYSTEM, prompt });
    calls.push({
      provider: "claude-agent",
      model: AGENT.research,
      stage: "research",
      promptHash: sha256(prompt),
      usage: r.usage,
      costUsd: r.costUsd,
      latencyMs: Date.now() - t0,
      attempts: 1,
    });
    return { findings: r.findings, sources: r.citations };
  }
  const prompt = researchTaskGemini(input);
  const r = await generateGrounded({ model: GEMINI.research, system: CONSULTANT_SYSTEM, prompt });
  calls.push({
    provider: "gemini",
    model: GEMINI.research,
    stage: "research",
    promptHash: sha256(prompt),
    usage: r.usage,
    costUsd: null,
    latencyMs: Date.now() - t0,
    attempts: 1,
  });
  return { findings: r.text, sources: r.citations };
}

// --- generic structured step with schema+verify retry -----------------------

async function structuredStep<T>(args: {
  stage: string;
  model: string;
  buildPrompt: (feedback: string) => string;
  responseSchema: Record<string, unknown>;
  map: (raw: unknown) => T;
  /** Return violation strings; empty = accept. */
  check: (value: T) => string[];
  calls: CallTelemetry[];
}): Promise<T> {
  const t0 = Date.now();
  let usage: Usage = ZERO_USAGE;
  let feedback = "";
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = args.buildPrompt(feedback);
    const res = await generateStructured({
      model: args.model,
      system: CONSULTANT_SYSTEM,
      prompt,
      responseSchema: args.responseSchema,
      temperature: 0,
    });
    usage = addUsage(usage, res.usage);

    try {
      const value = args.map(extractJsonObject(res.text));
      const violations = args.check(value);
      if (violations.length === 0) {
        args.calls.push({
          provider: "gemini",
          model: args.model,
          stage: args.stage,
          promptHash: sha256(prompt),
          usage,
          costUsd: null,
          latencyMs: Date.now() - t0,
          attempts: attempt,
        });
        return value;
      }
      feedback = `Fix these problems from your previous attempt:\n- ${violations.join("\n- ")}`;
      lastError = violations.join("; ");
    } catch (e) {
      feedback = `Your output did not match the required schema: ${(e as Error).message}. Return only valid JSON matching the schema.`;
      lastError = (e as Error).message;
    }
  }

  args.calls.push({
    provider: "gemini",
    model: args.model,
    stage: args.stage,
    promptHash: sha256(`${args.stage}-failed`),
    usage,
    costUsd: null,
    latencyMs: Date.now() - t0,
    attempts: MAX_ATTEMPTS,
  });
  throw new AnalyzeError(`${args.stage} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// --- sanitize: guarantee VERIFY passes before we store ----------------------
// This does not weaken VERIFY — it removes/downgrades exactly the claims VERIFY
// rejects, so what we store is honest (an unverifiable claim becomes a low-
// confidence assumption, not a confident fact).

function sanitize(result: AnalysisResult, allowed: Set<string>): AnalysisResult {
  const fixClaims = <C extends CompanyProfile["facts"]>(claims: C): C =>
    claims.map((c) => {
      let { evidence, confidence } = c;
      if (evidence.kind === "citation" && !allowed.has(normalizeUrl(evidence.url))) {
        evidence = { kind: "assumption", note: "cited source was not retrieved; treat as unverified" };
        confidence = "low";
      }
      if (evidence.kind === "assumption" && confidence === "high") confidence = "medium";
      if (confidence === "high") {
        const hedged = ["probably", "likely", "typically", "presumably", "generally", "usually"].some((w) =>
          c.statement.toLowerCase().includes(w),
        );
        if (hedged) confidence = "medium";
      }
      return { ...c, evidence, confidence };
    }) as C;

  const company: CompanyProfile = {
    ...result.company,
    facts: fixClaims(result.company.facts),
    financials:
      result.company.financials.status === "disclosed" && result.company.financials.evidence.kind === "assumption"
        ? { status: "unavailable" }
        : result.company.financials,
  };
  const swot: Swot = {
    strengths: fixClaims(result.swot.strengths),
    weaknesses: fixClaims(result.swot.weaknesses),
    opportunities: fixClaims(result.swot.opportunities),
    threats: fixClaims(result.swot.threats),
  };
  const cleaned: AnalysisResult = { ...result, company, swot };
  const claims = collectClaims(cleaned).map((c) => c.claim);
  cleaned.confidence = computeModuleConfidence(claims, cleaned.sources, Date.now());
  return cleaned;
}

// --- public entry -----------------------------------------------------------

export interface AnalyzeOutput {
  companyId: string;
  analysisId: string;
  result: AnalysisResult;
  lowConfidence: boolean;
}

export async function runSwotAnalysis(input: CompanyInput): Promise<AnalyzeOutput> {
  const calls: CallTelemetry[] = [];

  const { findings, sources } = await research(input, calls);
  const allowed = new Set(sources.map((s) => normalizeUrl(s.url)));

  const invented = (urls: string[]) =>
    urls.filter((u) => !allowed.has(normalizeUrl(u))).map((u) => `Cited URL not in provided sources: ${u}`);

  const profile = await structuredStep<CompanyProfile>({
    stage: "extract",
    model: GEMINI.extract,
    buildPrompt: (fb) => (fb ? `${extractTask(input, findings, sources)}\n\n${fb}` : extractTask(input, findings, sources)),
    responseSchema: geminiProfileSchema,
    map: toCompanyProfile,
    check: (p) =>
      invented(p.facts.filter((c) => c.evidence.kind === "citation").map((c) => (c.evidence as { url: string }).url)),
    calls,
  });

  const { swot, notInData } = await structuredStep<{ swot: Swot; notInData: string[] }>({
    stage: "swot",
    model: GEMINI.analysis,
    buildPrompt: (fb) => {
      const base = swotTask(input, JSON.stringify(profile, null, 2), findings, sources);
      return fb ? `${base}\n\n${fb}` : base;
    },
    responseSchema: geminiSwotSchema,
    map: toSwot,
    check: ({ swot }) => {
      const all = [...swot.strengths, ...swot.weaknesses, ...swot.opportunities, ...swot.threats];
      return invented(all.filter((c) => c.evidence.kind === "citation").map((c) => (c.evidence as { url: string }).url));
    },
    calls,
  });

  let result: AnalysisResult = {
    company: profile,
    swot,
    sources,
    confidence: computeModuleConfidence(
      collectClaims({
        company: profile,
        swot,
        sources,
        notInData,
        confidence: { coveragePct: 0, sourceCount: 0, mostRecentSourceDaysAgo: null, band: "low" },
        provenance: placeholderProvenance(),
      }).map((c) => c.claim),
      sources,
      Date.now(),
    ),
    notInData,
    provenance: {
      researchProvider: researchProvider(),
      analysisModel: GEMINI.analysis,
      extractModel: GEMINI.extract,
      generatedAt: new Date().toISOString(),
    },
  };

  // VERIFY, then sanitize to guarantee a clean stored artifact.
  const report = verifyAnalysis(result, allowed, Date.now());
  if (!report.ok) result = sanitize(result, allowed);
  else result.confidence = report.confidence;

  const lowConfidence = result.confidence.band === "low";
  const modelVersion = JSON.stringify({
    system: CONSULTANT_SYSTEM_VERSION,
    research: RESEARCH_VERSION,
    extract: EXTRACT_VERSION,
    swot: SWOT_VERSION,
    models: { analysis: GEMINI.analysis, extract: GEMINI.extract, research: researchProvider() === "claude-agent" ? AGENT.research : GEMINI.research },
  });

  const { companyId, analysisId } = saveAnalysis({
    input,
    result,
    type: "swot",
    modelVersion,
    lowConfidence,
    calls,
  });

  return { companyId, analysisId, result, lowConfidence };
}

function placeholderProvenance(): AnalysisResult["provenance"] {
  return {
    researchProvider: researchProvider(),
    analysisModel: GEMINI.analysis,
    extractModel: GEMINI.extract,
    generatedAt: new Date().toISOString(),
  };
}
