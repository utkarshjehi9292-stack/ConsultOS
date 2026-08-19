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

import {
  GEMINI,
  AGENT,
  FLASH_MODEL,
  agentAvailable,
  isAllowedAnalysisModel,
  isAllowedResearchProvider,
  researchProvider,
  type Provider,
} from "./models";
import { generateGrounded, generateStructured, sha256, GeminiError } from "./providers/gemini";
import { researchWithAgent } from "./providers/agent";
import { extractJsonObject } from "./extract-json";
import {
  toCompanyProfile,
  toSwot,
  toGrowth,
  toMemo,
  geminiProfileSchema,
  geminiSwotSchema,
  geminiGrowthSchema,
  geminiMemoSchema,
} from "./wire";
import {
  computeModuleConfidence,
  normalizeUrl,
  verifyAnalysis,
  collectClaims,
  sanitizeClaim,
  checkProjection,
} from "./sanity";
import type {
  AnalysisResult,
  Citation,
  Claim,
  CompanyProfile,
  GrowthResult,
  Memo,
  MemoResult,
  Opportunity,
  StoredResult,
  Swot,
} from "./schemas";
import { addUsage, ZERO_USAGE, type CallTelemetry, type Usage } from "./telemetry";
import { CONSULTANT_SYSTEM, CONSULTANT_SYSTEM_VERSION } from "../prompts/system";
import {
  EXTRACT_VERSION,
  RESEARCH_VERSION,
  SWOT_VERSION,
  GROWTH_VERSION,
  MEMO_VERSION,
  extractTask,
  growthTask,
  memoTask,
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
  chosen: Provider,
  fallbackNotes: string[],
): Promise<{ findings: string; sources: Citation[]; usedProvider: Provider }> {
  const t0 = Date.now();
  let provider = chosen;
  if (provider === "claude-agent" && !agentAvailable()) {
    fallbackNotes.push("Claude Agent SDK research needs an ANTHROPIC_API_KEY; used Gemini + Google Search instead.");
    provider = "gemini";
  }
  if (provider === "claude-agent") {
    try {
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
      return { findings: r.findings, sources: r.citations, usedProvider: "claude-agent" };
    } catch (e) {
      // The Agent SDK spawns the Claude Code runtime; if that or its auth fails,
      // degrade to Gemini grounding rather than failing the whole analysis.
      fallbackNotes.push(
        `Claude Agent SDK research failed (${(e as Error).message?.slice(0, 140) ?? "unknown"}); used Gemini + Google Search instead.`,
      );
      provider = "gemini";
    }
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
  return { findings: r.text, sources: r.citations, usedProvider: "gemini" };
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
  result: StoredResult;
  lowConfidence: boolean;
}

type ModuleType = "swot" | "growth" | "memo";

function persist(
  input: CompanyInput,
  result: StoredResult,
  type: ModuleType,
  modelVersion: string,
  calls: CallTelemetry[],
): AnalyzeOutput {
  const lowConfidence = result.confidence.band === "low";
  const { companyId, analysisId } = saveAnalysis({ input, result, type, modelVersion, lowConfidence, calls });
  return { companyId, analysisId, result, lowConfidence };
}

export interface AnalyzeOptions {
  /** Analysis (SWOT) model chosen on the website; falls back to flash on quota. */
  analysisModel?: string;
  /** Research provider chosen on the website; falls back to Gemini if the Agent SDK has no key. */
  researchProvider?: string;
}

// Shared RESEARCH + EXTRACT stage, common to every module.
interface Gathered {
  calls: CallTelemetry[];
  fallbackNotes: string[];
  findings: string;
  sources: Citation[];
  allowed: Set<string>;
  profile: CompanyProfile;
  usedProvider: Provider;
  invented: (urls: string[]) => string[];
}

async function gather(input: CompanyInput, opts: AnalyzeOptions): Promise<Gathered> {
  const calls: CallTelemetry[] = [];
  const fallbackNotes: string[] = [];
  const chosenResearch =
    opts.researchProvider && isAllowedResearchProvider(opts.researchProvider)
      ? opts.researchProvider
      : researchProvider();
  const { findings, sources, usedProvider } = await research(input, calls, chosenResearch, fallbackNotes);
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
  return { calls, fallbackNotes, findings, sources, allowed, profile, usedProvider, invented };
}

/** Run a module's analysis step at the chosen model, auto-falling back to flash on 429. */
async function analysisStep<T>(
  opts: AnalyzeOptions,
  fallbackNotes: string[],
  make: (model: string) => Promise<T>,
): Promise<{ value: T; usedModel: string }> {
  const chosen = opts.analysisModel && isAllowedAnalysisModel(opts.analysisModel) ? opts.analysisModel : GEMINI.analysis;
  try {
    return { value: await make(chosen), usedModel: chosen };
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429 && chosen !== FLASH_MODEL) {
      fallbackNotes.push(`Analysis model ${chosen} hit its quota; fell back to ${FLASH_MODEL}.`);
      return { value: await make(FLASH_MODEL), usedModel: FLASH_MODEL };
    }
    throw e;
  }
}

function provenanceOf(usedProvider: Provider, usedModel: string): AnalysisResult["provenance"] {
  return {
    researchProvider: usedProvider,
    analysisModel: usedModel,
    extractModel: GEMINI.extract,
    generatedAt: new Date().toISOString(),
  };
}

function modelVersionOf(module: string, usedModel: string, usedProvider: Provider, moduleVersion: string): string {
  return JSON.stringify({
    module,
    system: CONSULTANT_SYSTEM_VERSION,
    research: RESEARCH_VERSION,
    extract: EXTRACT_VERSION,
    [module]: moduleVersion,
    models: {
      analysis: usedModel,
      extract: GEMINI.extract,
      research: usedProvider === "claude-agent" ? AGENT.research : GEMINI.research,
    },
  });
}

// --- Module 1: SWOT ---------------------------------------------------------

export async function runSwotAnalysis(input: CompanyInput, opts: AnalyzeOptions = {}): Promise<AnalyzeOutput> {
  const g = await gather(input, opts);

  const { value: swotOut, usedModel } = await analysisStep(opts, g.fallbackNotes, (model) =>
    structuredStep<{ swot: Swot; notInData: string[] }>({
      stage: "swot",
      model,
      buildPrompt: (fb) => {
        const base = swotTask(input, JSON.stringify(g.profile, null, 2), g.findings, g.sources);
        return fb ? `${base}\n\n${fb}` : base;
      },
      responseSchema: geminiSwotSchema,
      map: toSwot,
      check: ({ swot }) => {
        const all = [...swot.strengths, ...swot.weaknesses, ...swot.opportunities, ...swot.threats];
        return g.invented(all.filter((c) => c.evidence.kind === "citation").map((c) => (c.evidence as { url: string }).url));
      },
      calls: g.calls,
    }),
  );

  const notInData = [...swotOut.notInData, ...g.fallbackNotes];
  let result: AnalysisResult = {
    module: "swot",
    company: g.profile,
    swot: swotOut.swot,
    sources: g.sources,
    confidence: computeModuleConfidence([], g.sources, Date.now()),
    notInData,
    provenance: provenanceOf(g.usedProvider, usedModel),
  };
  const report = verifyAnalysis(result, g.allowed, Date.now());
  if (!report.ok) result = sanitize(result, g.allowed);
  else result.confidence = report.confidence;

  return persist(input, result, "swot", modelVersionOf("swot", usedModel, g.usedProvider, SWOT_VERSION), g.calls);
}

// --- Module 2: Growth Opportunity Engine (Ansoff) ---------------------------

export async function runGrowthAnalysis(input: CompanyInput, opts: AnalyzeOptions = {}): Promise<AnalyzeOutput> {
  const g = await gather(input, opts);

  const { value: growthOut, usedModel } = await analysisStep(opts, g.fallbackNotes, (model) =>
    structuredStep<{ opportunities: Opportunity[]; notInData: string[] }>({
      stage: "growth",
      model,
      buildPrompt: (fb) => {
        const base = growthTask(input, JSON.stringify(g.profile, null, 2), g.findings, g.sources);
        return fb ? `${base}\n\n${fb}` : base;
      },
      responseSchema: geminiGrowthSchema,
      map: toGrowth,
      check: ({ opportunities }) =>
        g.invented(
          opportunities.filter((o) => o.evidence.kind === "citation").map((o) => (o.evidence as { url: string }).url),
        ),
      calls: g.calls,
    }),
  );

  // Sanitize rationale claims, run projection sanity, rank by priority, pick best.
  const opportunities = growthOut.opportunities
    .map((o) => {
      const claim: Claim = { statement: o.rationale, evidence: o.evidence, confidence: o.confidence };
      const clean = sanitizeClaim(claim, g.allowed);
      let sanity = o.sanity;
      if (o.projection) {
        sanity = checkProjection({
          impliedMarketSharePct: o.projection.impliedMarketSharePct ?? 0,
          impliedHeadcount: o.projection.impliedHeadcount ?? 1,
          impliedCapitalNeed: o.projection.impliedCapitalNeed ?? 0,
        });
      }
      return { ...o, evidence: clean.evidence, confidence: clean.confidence, sanity };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const bestThisQuarter = opportunities.length ? opportunities[0]!.title : null;
  const claims: Claim[] = opportunities.map((o) => ({ statement: o.rationale, evidence: o.evidence, confidence: o.confidence }));

  const result: GrowthResult = {
    module: "growth",
    company: g.profile,
    growth: { opportunities, bestThisQuarter },
    sources: g.sources,
    confidence: computeModuleConfidence(claims, g.sources, Date.now()),
    notInData: [...growthOut.notInData, ...g.fallbackNotes],
    provenance: provenanceOf(g.usedProvider, usedModel),
  };

  return persist(input, result, "growth", modelVersionOf("growth", usedModel, g.usedProvider, GROWTH_VERSION), g.calls);
}

// --- Module 3: Consultant's Memo (Pyramid Principle) ------------------------

export async function runMemoAnalysis(input: CompanyInput, opts: AnalyzeOptions = {}): Promise<AnalyzeOutput> {
  const g = await gather(input, opts);

  const { value: memo, usedModel } = await analysisStep(opts, g.fallbackNotes, (model) =>
    structuredStep<Memo>({
      stage: "memo",
      model,
      buildPrompt: (fb) => {
        const base = memoTask(input, JSON.stringify(g.profile, null, 2), g.findings, g.sources);
        return fb ? `${base}\n\n${fb}` : base;
      },
      responseSchema: geminiMemoSchema,
      map: toMemo,
      check: (m) =>
        g.invented(m.arguments.filter((a) => a.evidence.kind === "citation").map((a) => (a.evidence as { url: string }).url)),
      calls: g.calls,
    }),
  );

  const cleanArgs = memo.arguments.map((a) => {
    const clean = sanitizeClaim({ statement: a.point, evidence: a.evidence, confidence: a.confidence }, g.allowed);
    return { ...a, evidence: clean.evidence, confidence: clean.confidence };
  });
  const claims: Claim[] = cleanArgs.map((a) => ({ statement: a.point, evidence: a.evidence, confidence: a.confidence }));

  const result: MemoResult = {
    module: "memo",
    company: g.profile,
    memo: { ...memo, arguments: cleanArgs },
    sources: g.sources,
    confidence: computeModuleConfidence(claims, g.sources, Date.now()),
    notInData: g.fallbackNotes,
    provenance: provenanceOf(g.usedProvider, usedModel),
  };

  return persist(input, result, "memo", modelVersionOf("memo", usedModel, g.usedProvider, MEMO_VERSION), g.calls);
}
