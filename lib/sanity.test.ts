import { describe, expect, it } from "vitest";
import {
  checkProjection,
  collectClaims,
  computeModuleConfidence,
  normalizeUrl,
  verifyAnalysis,
} from "./sanity";
import type { AnalysisResult, Citation, Claim } from "./schemas";

const SRC = "https://example.com/a";
const SRC2 = "https://example.com/b";

function citation(url = SRC): Citation {
  return { url, title: "Source", publisher: null, date: null };
}

function citedClaim(url = SRC, confidence: Claim["confidence"] = "high"): Claim {
  return {
    statement: "Company operates a subscription model.",
    evidence: { kind: "citation", url, title: "Source", quote: null },
    confidence,
  };
}

function assumptionClaim(confidence: Claim["confidence"] = "low"): Claim {
  return {
    statement: "The team is likely small.",
    evidence: { kind: "assumption", note: "no headcount disclosed" },
    confidence,
  };
}

function baseResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    company: {
      name: "Acme",
      sector: "SaaS",
      oneLiner: "A billing tool.",
      businessModel: "subscription",
      founded: null,
      hq: null,
      facts: [citedClaim()],
      financials: { status: "unavailable" },
    },
    swot: {
      strengths: [citedClaim()],
      weaknesses: [assumptionClaim()],
      opportunities: [],
      threats: [],
    },
    sources: [citation(SRC)],
    confidence: { coveragePct: 0, sourceCount: 0, mostRecentSourceDaysAgo: null, band: "low" },
    notInData: ["headcount", "revenue"],
    provenance: {
      researchProvider: "gemini",
      analysisModel: "gemini-3.1-pro-preview",
      extractModel: "gemini-3.7-flash",
      generatedAt: "2026-08-19T00:00:00Z",
    },
    ...over,
  };
}

const NOW = Date.parse("2026-08-19T00:00:00Z");

describe("normalizeUrl", () => {
  it("ignores trailing slash, hash, and host case", () => {
    expect(normalizeUrl("https://Example.com/a/#x")).toBe(normalizeUrl("https://example.com/a"));
  });
});

describe("verifyAnalysis — cite or flag", () => {
  it("passes a well-formed, fully-cited analysis", () => {
    const r = verifyAnalysis(baseResult(), [SRC], NOW);
    expect(r.ok).toBe(true);
    expect(r.violations.filter((v) => v.severity === "error")).toHaveLength(0);
  });

  it("rejects a cited URL that was never retrieved (invented source)", () => {
    const r = verifyAnalysis(baseResult({
      company: { ...baseResult().company, facts: [citedClaim("https://fake.invalid/x")] },
    }), [SRC], NOW);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === "invented-source")).toBe(true);
  });

  it("rejects an assumption marked high-confidence", () => {
    const r = verifyAnalysis(baseResult({
      swot: { strengths: [], weaknesses: [assumptionClaim("high")], opportunities: [], threats: [] },
    }), [SRC], NOW);
    expect(r.violations.some((v) => v.rule === "confident-assumption")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("rejects hedging language inside a high-confidence claim", () => {
    const hedged: Claim = {
      statement: "The company probably dominates its niche.",
      evidence: { kind: "citation", url: SRC, title: "S", quote: null },
      confidence: "high",
    };
    const r = verifyAnalysis(baseResult({
      company: { ...baseResult().company, facts: [hedged] },
    }), [SRC], NOW);
    expect(r.violations.some((v) => v.rule === "hedged-high-confidence")).toBe(true);
  });

  it("rejects a disclosed financial figure backed only by an assumption", () => {
    const r = verifyAnalysis(baseResult({
      company: {
        ...baseResult().company,
        financials: {
          status: "disclosed",
          figure: "₹4 Cr revenue",
          method: "guessed from headcount",
          evidence: { kind: "assumption", note: "no filing found" },
        },
      },
    }), [SRC], NOW);
    expect(r.violations.some((v) => v.rule === "fabricated-financials")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("treats a source listed in result.sources as an allowed citation target", () => {
    // Cited URL not in retrievedUrls, but present in result.sources → allowed.
    const r = verifyAnalysis(baseResult({
      company: { ...baseResult().company, facts: [citedClaim(SRC2)] },
      sources: [citation(SRC), citation(SRC2)],
    }), [SRC], NOW);
    expect(r.ok).toBe(true);
  });
});

describe("computeModuleConfidence", () => {
  it("is high with strong coverage and enough sources", () => {
    const claims = [citedClaim(), citedClaim(), citedClaim()];
    const sources = [citation(SRC), citation(SRC2), citation("https://example.com/c")];
    expect(computeModuleConfidence(claims, sources, NOW).band).toBe("high");
  });

  it("is low with no sources", () => {
    const c = computeModuleConfidence([assumptionClaim()], [], NOW);
    expect(c.band).toBe("low");
    expect(c.coveragePct).toBe(0);
  });

  it("computes recency from the most recent dated source", () => {
    const sources: Citation[] = [
      { url: SRC, title: "old", publisher: null, date: "2020-01-01" },
      { url: SRC2, title: "new", publisher: null, date: "2026-08-09" },
    ];
    const c = computeModuleConfidence([citedClaim()], sources, NOW);
    expect(c.mostRecentSourceDaysAgo).toBe(10);
  });
});

describe("collectClaims", () => {
  it("gathers claims from facts and all four SWOT quadrants with paths", () => {
    const claims = collectClaims(baseResult());
    expect(claims.map((c) => c.path)).toEqual([
      "company.facts[0]",
      "swot.strengths[0]",
      "swot.weaknesses[0]",
    ]);
  });
});

describe("checkProjection (Milestone 2 sanity, tested now)", () => {
  it("fails when implied market share exceeds 100%", () => {
    const r = checkProjection({ impliedMarketSharePct: 140, impliedHeadcount: 50, impliedCapitalNeed: 1e7 });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/exceeds 100%/);
  });

  it("warns on aggressive-but-possible share and 10x hiring", () => {
    const r = checkProjection({
      impliedMarketSharePct: 55,
      impliedHeadcount: 200,
      impliedCapitalNeed: 5e6,
      currentHeadcount: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("fails on non-positive headcount or negative capital", () => {
    expect(checkProjection({ impliedMarketSharePct: 5, impliedHeadcount: 0, impliedCapitalNeed: 1 }).ok).toBe(false);
    expect(checkProjection({ impliedMarketSharePct: 5, impliedHeadcount: 5, impliedCapitalNeed: -1 }).ok).toBe(false);
  });
});
