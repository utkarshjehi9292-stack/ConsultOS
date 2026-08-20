import { describe, expect, it } from "vitest";
import { toGrowth, toMemo, toValueChain, toCompanyProfile, toSwot } from "./wire";
import { GrowthResultSchema, MemoResultSchema, ValueChainResultSchema } from "./schemas";

describe("toGrowth", () => {
  const raw = {
    opportunities: [
      {
        title: "Expand into quick-commerce",
        ansoff: "market_development",
        rationale: "Adjacent channel for existing SKUs.",
        evidenceKind: "citation",
        sourceUrl: "https://example.com/a",
        sourceTitle: "Report",
        confidence: "medium",
        adjacency: 4,
        attractiveness: 5,
        difficulty: 2,
        adjacencyReason: "same SKUs",
        attractivenessReason: "fast-growing channel",
        difficultyReason: "new logistics",
        scenarios: [
          { level: "base", value: "₹8 Cr incremental", driver: "5% attach rate" },
          { level: "high", value: "₹14 Cr", driver: "10% attach rate" },
        ],
        impliedMarketSharePct: 6,
        impliedHeadcount: 40,
        impliedCapitalNeed: 20000000,
      },
      {
        title: "Launch a premium line",
        ansoff: "product_development",
        rationale: "Untapped premium demand.",
        evidenceKind: "assumption",
        assumptionNote: "no survey data",
        confidence: "low",
        adjacency: 3,
        attractiveness: 3,
        difficulty: 3,
        adjacencyReason: "brand stretch",
        attractivenessReason: "moderate",
        difficultyReason: "R&D",
      },
    ],
    notInData: ["current channel mix"],
  };

  it("computes priorityScore = adjacency × attractiveness ÷ difficulty", () => {
    const { opportunities } = toGrowth(raw);
    const qc = opportunities.find((o) => o.title.includes("quick-commerce"))!;
    expect(qc.priorityScore).toBe(10); // 4*5/2
    const prem = opportunities.find((o) => o.title.includes("premium"))!;
    expect(prem.priorityScore).toBe(3); // 3*3/3
  });

  it("maps evidence union and detects a projection only when numbers exist", () => {
    const { opportunities } = toGrowth(raw);
    const qc = opportunities[0]!;
    expect(qc.evidence.kind).toBe("citation");
    expect(qc.projection).not.toBeNull();
    expect(qc.projection!.impliedMarketSharePct).toBe(6);
    const prem = opportunities[1]!;
    expect(prem.evidence.kind).toBe("assumption");
    expect(prem.projection).toBeNull();
    expect(qc.scenarios).toHaveLength(2);
  });

  it("clamps out-of-range scores into 1–5", () => {
    const { opportunities } = toGrowth({
      opportunities: [
        {
          title: "x",
          ansoff: "diversification",
          rationale: "y",
          evidenceKind: "assumption",
          assumptionNote: "z",
          confidence: "low",
          adjacency: 9,
          attractiveness: 0,
          difficulty: 7,
          adjacencyReason: "a",
          attractivenessReason: "b",
          difficultyReason: "c",
        },
      ],
    });
    const o = opportunities[0]!;
    expect(o.scores.adjacency).toBe(5);
    expect(o.scores.attractiveness).toBe(1);
    expect(o.scores.difficulty).toBe(5);
  });

  it("produces output that validates against GrowthResultSchema", () => {
    const { opportunities, notInData } = toGrowth(raw);
    const r = GrowthResultSchema.safeParse({
      module: "growth",
      company: toCompanyProfile({ name: "Acme", oneLiner: "x", facts: [], financialsStatus: "unavailable" }),
      growth: { opportunities, bestThisQuarter: opportunities[0]!.title },
      sources: [],
      confidence: { coveragePct: 50, sourceCount: 1, mostRecentSourceDaysAgo: null, band: "medium" },
      notInData,
      provenance: { researchProvider: "gemini", analysisModel: "m", extractModel: "e", generatedAt: "t" },
    });
    expect(r.success).toBe(true);
  });
});

describe("toMemo", () => {
  const raw = {
    answer: "Double down on the enterprise segment.",
    arguments: [
      { point: "Enterprise LTV is higher.", evidenceKind: "citation", sourceUrl: "https://example.com/a", sourceTitle: "S", confidence: "medium" },
      { point: "SMB churn is rising.", evidenceKind: "assumption", assumptionNote: "inferred", confidence: "low" },
    ],
    thereforeAction: "Reallocate 30% of sales to enterprise",
    thereforeTimeframe: "next quarter",
    dataQualityNote: null,
    confidenceOutOf10: 6,
  };

  it("maps to the Pyramid-Principle memo shape", () => {
    const m = toMemo(raw);
    expect(m.answer).toMatch(/enterprise/i);
    expect(m.arguments).toHaveLength(2);
    expect(m.arguments[0]!.evidence.kind).toBe("citation");
    expect(m.therefore).toEqual({ action: "Reallocate 30% of sales to enterprise", timeframe: "next quarter" });
    expect(m.confidenceOutOf10).toBe(6);
  });

  it("caps arguments at 3 and clamps confidence 0–10", () => {
    const m = toMemo({
      ...raw,
      confidenceOutOf10: 99,
      arguments: [raw.arguments[0], raw.arguments[0], raw.arguments[0], raw.arguments[0]],
    });
    expect(m.arguments.length).toBeLessThanOrEqual(3);
    expect(m.confidenceOutOf10).toBe(10);
  });

  it("validates against MemoResultSchema", () => {
    const r = MemoResultSchema.safeParse({
      module: "memo",
      company: toCompanyProfile({ name: "Acme", oneLiner: "x", facts: [], financialsStatus: "unavailable" }),
      memo: toMemo(raw),
      sources: [],
      confidence: { coveragePct: 50, sourceCount: 1, mostRecentSourceDaysAgo: null, band: "medium" },
      notInData: [],
      provenance: { researchProvider: "gemini", analysisModel: "m", extractModel: "e", generatedAt: "t" },
    });
    expect(r.success).toBe(true);
  });
});

describe("toValueChain", () => {
  const raw = {
    steps: [
      {
        step: "Restaurant onboarding",
        performedBy: "in-house sales team",
        significance: "high",
        likelyLeak: "high CAC per merchant vs. take rate",
        evidenceKind: "assumption",
        assumptionNote: "typical for marketplaces",
        confidence: "medium",
      },
      {
        step: "Last-mile delivery",
        performedBy: "gig fleet partners",
        significance: "medium",
        likelyLeak: "delivery cost subsidy",
        evidenceKind: "citation",
        sourceUrl: "https://example.com/a",
        sourceTitle: "Report",
        confidence: "medium",
      },
    ],
    notInData: ["exact take rate"],
  };

  it("maps steps with performedBy, significance, leak, and evidence union", () => {
    const { steps, notInData } = toValueChain(raw);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.performedBy).toMatch(/in-house/);
    expect(steps[0]!.significance).toBe("high");
    expect(steps[0]!.evidence.kind).toBe("assumption");
    expect(steps[1]!.evidence.kind).toBe("citation");
    expect(notInData).toContain("exact take rate");
  });

  it("validates against ValueChainResultSchema", () => {
    const { steps } = toValueChain(raw);
    const r = ValueChainResultSchema.safeParse({
      module: "valuechain",
      company: toCompanyProfile({ name: "Acme", oneLiner: "x", facts: [], financialsStatus: "unavailable" }),
      valueChain: { steps, biggestLeak: steps[0]!.step },
      sources: [],
      confidence: { coveragePct: 50, sourceCount: 1, mostRecentSourceDaysAgo: null, band: "medium" },
      notInData: [],
      provenance: { researchProvider: "gemini", analysisModel: "m", extractModel: "e", generatedAt: "t" },
    });
    expect(r.success).toBe(true);
  });
});

// keep the existing mappers honest
describe("SWOT/profile mappers still round-trip", () => {
  it("maps a minimal profile and swot", () => {
    const p = toCompanyProfile({ name: "Acme", oneLiner: "A tool", facts: [], financialsStatus: "unavailable" });
    expect(p.name).toBe("Acme");
    const { swot } = toSwot({ strengths: [], weaknesses: [], opportunities: [], threats: [] });
    expect(swot.strengths).toEqual([]);
  });
});
