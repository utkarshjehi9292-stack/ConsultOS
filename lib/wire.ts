// Bridge between Gemini's JSON output and the Zod domain types.
//
// Gemini's `responseSchema` is an OpenAPI subset — it handles flat objects,
// enums, and nullables well but not tagged unions. So the model emits a FLAT
// evidence shape (evidenceKind + sourceUrl/assumptionNote), and we fold it into
// the discriminated `Evidence` union here, then validate with the domain Zod
// schemas (which reject anything malformed → triggers the retry).

import {
  CompanyProfileSchema,
  CompetitorSchema,
  MemoSchema,
  OpportunitySchema,
  SwotSchema,
  ValueChainStepSchema,
  type Claim,
  type CompanyProfile,
  type Competitor,
  type Memo,
  type Opportunity,
  type Swot,
  type ValueChainStep,
} from "./schemas";

// --- Gemini responseSchema objects (guide generation) ------------------------

const geminiClaim = {
  type: "object",
  properties: {
    statement: { type: "string" },
    evidenceKind: { type: "string", enum: ["citation", "assumption"] },
    sourceUrl: { type: "string", nullable: true },
    sourceTitle: { type: "string", nullable: true },
    quote: { type: "string", nullable: true },
    assumptionNote: { type: "string", nullable: true },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["statement", "evidenceKind", "confidence"],
  propertyOrdering: [
    "statement",
    "evidenceKind",
    "sourceUrl",
    "sourceTitle",
    "quote",
    "assumptionNote",
    "confidence",
  ],
} as const;

export const geminiProfileSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string" },
    sector: { type: "string", nullable: true },
    oneLiner: { type: "string" },
    businessModel: { type: "string", nullable: true },
    founded: { type: "string", nullable: true },
    hq: { type: "string", nullable: true },
    facts: { type: "array", items: geminiClaim },
    financialsStatus: { type: "string", enum: ["unavailable", "disclosed"] },
    financialsFigure: { type: "string", nullable: true },
    financialsMethod: { type: "string", nullable: true },
    financialsEvidenceKind: { type: "string", enum: ["citation", "assumption"], nullable: true },
    financialsSourceUrl: { type: "string", nullable: true },
    financialsSourceTitle: { type: "string", nullable: true },
    financialsAssumptionNote: { type: "string", nullable: true },
  },
  required: ["name", "oneLiner", "facts", "financialsStatus"],
};

export const geminiSwotSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    strengths: { type: "array", items: geminiClaim },
    weaknesses: { type: "array", items: geminiClaim },
    opportunities: { type: "array", items: geminiClaim },
    threats: { type: "array", items: geminiClaim },
    notInData: { type: "array", items: { type: "string" } },
  },
  required: ["strengths", "weaknesses", "opportunities", "threats"],
};

// --- defensive readers -------------------------------------------------------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function clampScore(v: unknown): number {
  const n = Math.round(num(v));
  return Math.max(1, Math.min(5, n || 1));
}

function mapClaim(raw: unknown): Claim {
  const c = obj(raw);
  const kind = str(c.evidenceKind) === "assumption" ? "assumption" : "citation";
  const confidenceRaw = str(c.confidence);
  const confidence = (["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "low") as Claim["confidence"];
  const evidence: Claim["evidence"] =
    kind === "citation"
      ? { kind: "citation", url: str(c.sourceUrl), title: strOrNull(c.sourceTitle) ?? str(c.sourceUrl), quote: strOrNull(c.quote) }
      : { kind: "assumption", note: strOrNull(c.assumptionNote) ?? "unspecified assumption" };
  return { statement: str(c.statement), evidence, confidence };
}

/** Map Gemini's flat profile shape into a validated `CompanyProfile`. Throws (via Zod) on malformed output. */
export function toCompanyProfile(raw: unknown): CompanyProfile {
  const p = obj(raw);
  const status = str(p.financialsStatus) === "disclosed" ? "disclosed" : "unavailable";
  let financials: CompanyProfile["financials"];
  if (status === "disclosed") {
    const evKind = str(p.financialsEvidenceKind) === "assumption" ? "assumption" : "citation";
    financials = {
      status: "disclosed",
      figure: str(p.financialsFigure),
      method: strOrNull(p.financialsMethod) ?? "unspecified",
      evidence:
        evKind === "citation"
          ? { kind: "citation", url: str(p.financialsSourceUrl), title: strOrNull(p.financialsSourceTitle) ?? str(p.financialsSourceUrl), quote: null }
          : { kind: "assumption", note: strOrNull(p.financialsAssumptionNote) ?? "unspecified" },
    };
  } else {
    financials = { status: "unavailable" };
  }
  return CompanyProfileSchema.parse({
    name: str(p.name),
    sector: strOrNull(p.sector),
    oneLiner: str(p.oneLiner),
    businessModel: strOrNull(p.businessModel),
    founded: strOrNull(p.founded),
    hq: strOrNull(p.hq),
    facts: arr(p.facts).map(mapClaim),
    financials,
  });
}

/** Map Gemini's SWOT shape into a validated `Swot` plus the notInData list. */
export function toSwot(raw: unknown): { swot: Swot; notInData: string[] } {
  const s = obj(raw);
  const swot = SwotSchema.parse({
    strengths: arr(s.strengths).map(mapClaim),
    weaknesses: arr(s.weaknesses).map(mapClaim),
    opportunities: arr(s.opportunities).map(mapClaim),
    threats: arr(s.threats).map(mapClaim),
  });
  const notInData = arr(s.notInData).map(str).filter((x) => x.length > 0);
  return { swot, notInData };
}

// --- Growth Opportunity Engine ----------------------------------------------

const geminiOpportunity = {
  type: "object",
  properties: {
    title: { type: "string" },
    ansoff: {
      type: "string",
      enum: ["market_penetration", "market_development", "product_development", "diversification"],
    },
    rationale: { type: "string" },
    evidenceKind: { type: "string", enum: ["citation", "assumption"] },
    sourceUrl: { type: "string", nullable: true },
    sourceTitle: { type: "string", nullable: true },
    assumptionNote: { type: "string", nullable: true },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    adjacency: { type: "integer" },
    attractiveness: { type: "integer" },
    difficulty: { type: "integer" },
    adjacencyReason: { type: "string" },
    attractivenessReason: { type: "string" },
    difficultyReason: { type: "string" },
    scenarios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["low", "base", "high"] },
          value: { type: "string" },
          driver: { type: "string" },
        },
        required: ["level", "value", "driver"],
      },
    },
    impliedMarketSharePct: { type: "number", nullable: true },
    impliedHeadcount: { type: "number", nullable: true },
    impliedCapitalNeed: { type: "number", nullable: true },
  },
  required: [
    "title",
    "ansoff",
    "rationale",
    "evidenceKind",
    "confidence",
    "adjacency",
    "attractiveness",
    "difficulty",
    "adjacencyReason",
    "attractivenessReason",
    "difficultyReason",
  ],
} as const;

export const geminiGrowthSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    opportunities: { type: "array", items: geminiOpportunity },
    notInData: { type: "array", items: { type: "string" } },
  },
  required: ["opportunities"],
};

function mapOpportunity(raw: unknown): Opportunity {
  const o = obj(raw);
  const kind = str(o.evidenceKind) === "assumption" ? "assumption" : "citation";
  const evidence =
    kind === "citation"
      ? { kind: "citation" as const, url: str(o.sourceUrl), title: strOrNull(o.sourceTitle) ?? str(o.sourceUrl), quote: null }
      : { kind: "assumption" as const, note: strOrNull(o.assumptionNote) ?? "inference from company profile" };
  const adjacency = clampScore(o.adjacency);
  const attractiveness = clampScore(o.attractiveness);
  const difficulty = clampScore(o.difficulty);
  const confidenceRaw = str(o.confidence);
  const confidence = (["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "low") as Opportunity["confidence"];
  const ansoffRaw = str(o.ansoff);
  const ansoff = (
    ["market_penetration", "market_development", "product_development", "diversification"].includes(ansoffRaw)
      ? ansoffRaw
      : "market_penetration"
  ) as Opportunity["ansoff"];

  const scenarios = arr(o.scenarios)
    .map((s) => obj(s))
    .filter((s) => ["low", "base", "high"].includes(str(s.level)) && str(s.value))
    .map((s) => ({ level: str(s.level) as "low" | "base" | "high", value: str(s.value), driver: str(s.driver) || "unstated" }));

  const projValues = [o.impliedMarketSharePct, o.impliedHeadcount, o.impliedCapitalNeed];
  const hasProjection = projValues.some((v) => typeof v === "number" && Number.isFinite(v));
  const projection = hasProjection
    ? {
        impliedMarketSharePct: numOrNull(o.impliedMarketSharePct),
        impliedHeadcount: numOrNull(o.impliedHeadcount),
        impliedCapitalNeed: numOrNull(o.impliedCapitalNeed),
      }
    : null;

  return OpportunitySchema.parse({
    title: str(o.title),
    ansoff,
    rationale: str(o.rationale) || "unstated",
    evidence,
    confidence,
    scores: { adjacency, attractiveness, difficulty },
    scoreReasoning: {
      adjacency: str(o.adjacencyReason) || "unstated",
      attractiveness: str(o.attractivenessReason) || "unstated",
      difficulty: str(o.difficultyReason) || "unstated",
    },
    // adjacency × attractiveness ÷ difficulty — computed here, not by the model.
    priorityScore: Math.round(((adjacency * attractiveness) / difficulty) * 100) / 100,
    scenarios,
    projection,
    sanity: null,
  });
}

/** Map Gemini's growth output → ranked Opportunity[] + notInData (sanity filled by the orchestrator). */
export function toGrowth(raw: unknown): { opportunities: Opportunity[]; notInData: string[] } {
  const g = obj(raw);
  const opportunities = arr(g.opportunities).map(mapOpportunity);
  const notInData = arr(g.notInData).map(str).filter((x) => x.length > 0);
  return { opportunities, notInData };
}

// --- Consultant's Memo (Pyramid Principle) ----------------------------------

export const geminiMemoSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    answer: { type: "string" },
    arguments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          evidenceKind: { type: "string", enum: ["citation", "assumption"] },
          sourceUrl: { type: "string", nullable: true },
          sourceTitle: { type: "string", nullable: true },
          assumptionNote: { type: "string", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["point", "evidenceKind", "confidence"],
      },
    },
    thereforeAction: { type: "string" },
    thereforeTimeframe: { type: "string" },
    dataQualityNote: { type: "string", nullable: true },
    confidenceOutOf10: { type: "number" },
  },
  required: ["answer", "thereforeAction", "thereforeTimeframe", "confidenceOutOf10"],
};

export function toMemo(raw: unknown): Memo {
  const m = obj(raw);
  const args = arr(m.arguments)
    .slice(0, 3)
    .map((a) => {
      const c = obj(a);
      const kind = str(c.evidenceKind) === "assumption" ? "assumption" : "citation";
      const confidenceRaw = str(c.confidence);
      const confidence = (["high", "medium", "low"].includes(confidenceRaw) ? confidenceRaw : "low") as Claim["confidence"];
      return {
        point: str(c.point),
        evidence:
          kind === "citation"
            ? { kind: "citation" as const, url: str(c.sourceUrl), title: strOrNull(c.sourceTitle) ?? str(c.sourceUrl), quote: null }
            : { kind: "assumption" as const, note: strOrNull(c.assumptionNote) ?? "inference" },
        confidence,
      };
    });
  return MemoSchema.parse({
    answer: str(m.answer),
    arguments: args,
    therefore: { action: str(m.thereforeAction) || "unstated", timeframe: str(m.thereforeTimeframe) || "unstated" },
    dataQualityNote: strOrNull(m.dataQualityNote),
    confidenceOutOf10: Math.max(0, Math.min(10, num(m.confidenceOutOf10))),
  });
}

// --- Value Chain Diagnostics (Milestone 3) ----------------------------------

export const geminiValueChainSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "string" },
          performedBy: { type: "string" },
          significance: { type: "string", enum: ["high", "medium", "low"] },
          likelyLeak: { type: "string" },
          evidenceKind: { type: "string", enum: ["citation", "assumption"] },
          sourceUrl: { type: "string", nullable: true },
          sourceTitle: { type: "string", nullable: true },
          assumptionNote: { type: "string", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["step", "performedBy", "significance", "likelyLeak", "evidenceKind", "confidence"],
      },
    },
    notInData: { type: "array", items: { type: "string" } },
  },
  required: ["steps"],
};

function conf(v: unknown): "high" | "medium" | "low" {
  const s = str(v);
  return (["high", "medium", "low"].includes(s) ? s : "low") as "high" | "medium" | "low";
}

function mapValueChainStep(raw: unknown): ValueChainStep {
  const s = obj(raw);
  const kind = str(s.evidenceKind) === "assumption" ? "assumption" : "citation";
  const evidence =
    kind === "citation"
      ? { kind: "citation" as const, url: str(s.sourceUrl), title: strOrNull(s.sourceTitle) ?? str(s.sourceUrl), quote: null }
      : { kind: "assumption" as const, note: strOrNull(s.assumptionNote) ?? "inference from the business model" };
  return ValueChainStepSchema.parse({
    step: str(s.step),
    performedBy: str(s.performedBy) || "unstated",
    significance: conf(s.significance),
    likelyLeak: str(s.likelyLeak) || "unstated",
    evidence,
    confidence: conf(s.confidence),
  });
}

export function toValueChain(raw: unknown): { steps: ValueChainStep[]; notInData: string[] } {
  const v = obj(raw);
  const steps = arr(v.steps).map(mapValueChainStep);
  const notInData = arr(v.notInData).map(str).filter((x) => x.length > 0);
  return { steps, notInData };
}

// --- Competitive Radar (Milestone 3) ----------------------------------------

export const geminiCompetitionSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["direct", "indirect", "emerging"] },
          positioning: { type: "string" },
          threat: { type: "string", enum: ["high", "medium", "low"] },
          evidenceKind: { type: "string", enum: ["citation", "assumption"] },
          sourceUrl: { type: "string", nullable: true },
          sourceTitle: { type: "string", nullable: true },
          assumptionNote: { type: "string", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "type", "positioning", "threat", "evidenceKind", "confidence"],
      },
    },
    incumbentThreat: { type: "string", nullable: true },
    channelPowerThreat: { type: "string", nullable: true },
    recentMA: { type: "string", nullable: true },
    notInData: { type: "array", items: { type: "string" } },
  },
  required: ["competitors"],
};

function mapCompetitor(raw: unknown): Competitor {
  const c = obj(raw);
  const kind = str(c.evidenceKind) === "assumption" ? "assumption" : "citation";
  const evidence =
    kind === "citation"
      ? { kind: "citation" as const, url: str(c.sourceUrl), title: strOrNull(c.sourceTitle) ?? str(c.sourceUrl), quote: null }
      : { kind: "assumption" as const, note: strOrNull(c.assumptionNote) ?? "inference from the market" };
  const typeRaw = str(c.type);
  const type = (["direct", "indirect", "emerging"].includes(typeRaw) ? typeRaw : "direct") as Competitor["type"];
  return CompetitorSchema.parse({
    name: str(c.name),
    type,
    positioning: str(c.positioning) || "unstated",
    threat: conf(c.threat),
    evidence,
    confidence: conf(c.confidence),
  });
}

export function toCompetition(raw: unknown): {
  competitors: Competitor[];
  incumbentThreat: string | null;
  channelPowerThreat: string | null;
  recentMA: string | null;
  notInData: string[];
} {
  const c = obj(raw);
  return {
    competitors: arr(c.competitors).map(mapCompetitor),
    incumbentThreat: strOrNull(c.incumbentThreat),
    channelPowerThreat: strOrNull(c.channelPowerThreat),
    recentMA: strOrNull(c.recentMA),
    notInData: arr(c.notInData).map(str).filter((x) => x.length > 0),
  };
}
