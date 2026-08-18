// Bridge between Gemini's JSON output and the Zod domain types.
//
// Gemini's `responseSchema` is an OpenAPI subset — it handles flat objects,
// enums, and nullables well but not tagged unions. So the model emits a FLAT
// evidence shape (evidenceKind + sourceUrl/assumptionNote), and we fold it into
// the discriminated `Evidence` union here, then validate with the domain Zod
// schemas (which reject anything malformed → triggers the retry).

import {
  CompanyProfileSchema,
  SwotSchema,
  type Claim,
  type CompanyProfile,
  type Swot,
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
