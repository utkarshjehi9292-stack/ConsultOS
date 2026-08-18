// The VERIFY stage: machine checks, not a model. Pure functions — no I/O, no
// network — so they are unit-testable and deterministic. This layer is "the
// product's credibility" (CLAUDE.md) and is tested first.
//
// It enforces, in code, the non-negotiables the model cannot be trusted to
// self-enforce:
//   1. Cite or flag — every claim is a citation or an explicit assumption.
//   2. No invented sources — a cited URL must be one research actually retrieved.
//   3. No fabricated financials — a disclosed figure needs a source, not a guess.
//   4. No confident hedging — "probably/likely/typically" can't ride on "high".
//   5. Confidence scores — coverage % and source recency, computed not claimed.

import type {
  AnalysisResult,
  Citation,
  Claim,
  ModuleConfidence,
} from "./schemas";

export type Severity = "error" | "warning";

export interface Violation {
  severity: Severity;
  rule: string;
  message: string;
  path: string;
}

export interface VerifyReport {
  ok: boolean; // true when there are zero error-severity violations
  violations: Violation[];
  confidence: ModuleConfidence;
}

const HEDGE_WORDS = [
  "probably",
  "likely",
  "typically",
  "presumably",
  "generally",
  "usually",
  "i think",
  "seems to",
  "appears to",
];

/** Normalize a URL for set-membership comparison (host-lowercase, no trailing slash, no hash). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

/** Every claim across the profile facts and all four SWOT quadrants, with its path. */
export function collectClaims(result: AnalysisResult): Array<{ claim: Claim; path: string }> {
  const out: Array<{ claim: Claim; path: string }> = [];
  result.company.facts.forEach((c, i) => out.push({ claim: c, path: `company.facts[${i}]` }));
  (["strengths", "weaknesses", "opportunities", "threats"] as const).forEach((q) => {
    result.swot[q].forEach((c, i) => out.push({ claim: c, path: `swot.${q}[${i}]` }));
  });
  return out;
}

function daysBetween(a: number, b: number): number {
  return Math.floor(Math.abs(a - b) / 86_400_000);
}

/**
 * Compute module confidence from grounded coverage and source recency.
 * `nowMs` is injected so the function stays pure and testable.
 */
export function computeModuleConfidence(
  claims: Claim[],
  sources: Citation[],
  nowMs: number,
): ModuleConfidence {
  const total = claims.length;
  const grounded = claims.filter((c) => c.evidence.kind === "citation").length;
  const coveragePct = total === 0 ? 0 : Math.round((grounded / total) * 100);

  let mostRecentDaysAgo: number | null = null;
  for (const s of sources) {
    if (!s.date) continue;
    const t = Date.parse(s.date);
    if (Number.isNaN(t)) continue;
    const d = daysBetween(nowMs, t);
    mostRecentDaysAgo = mostRecentDaysAgo === null ? d : Math.min(mostRecentDaysAgo, d);
  }

  let band: ModuleConfidence["band"] = "medium";
  if (coveragePct >= 70 && sources.length >= 3) band = "high";
  else if (coveragePct < 40 || sources.length === 0) band = "low";

  return { coveragePct, sourceCount: sources.length, mostRecentSourceDaysAgo: mostRecentDaysAgo, band };
}

/**
 * Run the full VERIFY pass. `retrievedUrls` is the set of source URLs research
 * actually returned — any cited URL outside it is an invented source (rejected).
 */
export function verifyAnalysis(
  result: AnalysisResult,
  retrievedUrls: Iterable<string>,
  nowMs: number,
): VerifyReport {
  const violations: Violation[] = [];
  const allowed = new Set<string>();
  for (const u of retrievedUrls) allowed.add(normalizeUrl(u));
  for (const s of result.sources) allowed.add(normalizeUrl(s.url));

  const claims = collectClaims(result);

  for (const { claim, path } of claims) {
    const { evidence, confidence, statement } = claim;

    if (evidence.kind === "citation") {
      // Rule 2: no invented sources.
      if (!allowed.has(normalizeUrl(evidence.url))) {
        violations.push({
          severity: "error",
          rule: "invented-source",
          message: `Cited URL is not among retrieved sources: ${evidence.url}`,
          path,
        });
      }
    } else {
      // Rule 1 satisfied structurally (assumption). Rule 4a: an assumption can't be "high".
      if (confidence === "high") {
        violations.push({
          severity: "error",
          rule: "confident-assumption",
          message: "An assumption cannot carry high confidence.",
          path,
        });
      }
    }

    // Rule 4b: no hedging words in a high-confidence statement.
    if (confidence === "high") {
      const lower = statement.toLowerCase();
      const hit = HEDGE_WORDS.find((w) => lower.includes(w));
      if (hit) {
        violations.push({
          severity: "error",
          rule: "hedged-high-confidence",
          message: `High-confidence claim uses hedging language ("${hit}").`,
          path,
        });
      }
    }
  }

  // Rule 3: no fabricated financials.
  const fin = result.company.financials;
  if (fin.status === "disclosed" && fin.evidence.kind === "assumption") {
    violations.push({
      severity: "error",
      rule: "fabricated-financials",
      message: "A disclosed financial figure must cite a source, not be an assumption.",
      path: "company.financials",
    });
  }

  // Honesty nudge: if nothing was flagged as unknown and coverage is imperfect,
  // that's suspicious but not fatal.
  const confidence = computeModuleConfidence(
    claims.map((c) => c.claim),
    result.sources,
    nowMs,
  );
  if (result.notInData.length === 0 && confidence.coveragePct < 100) {
    violations.push({
      severity: "warning",
      rule: "empty-not-in-data",
      message: "Coverage is incomplete but nothing is listed in notInData.",
      path: "notInData",
    });
  }

  const ok = violations.every((v) => v.severity !== "error");
  return { ok, violations, confidence };
}

// --- Forward-looking projection sanity (Growth engine, Milestone 2) ----------
// Built and tested now because CLAUDE.md requires the sanity-check layer tested
// first. A growth projection must survive these before it can ship.

export interface ProjectionInputs {
  /** Implied share of the serviceable market the projection assumes, 0–100+. */
  impliedMarketSharePct: number;
  /** Headcount the revenue implies (revenue / revenue-per-head). */
  impliedHeadcount: number;
  /** Capital the plan implies it needs, in the same currency throughout. */
  impliedCapitalNeed: number;
  /** Optional context to sharpen the checks. */
  currentHeadcount?: number;
}

export interface ProjectionCheck {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

/**
 * Automated plausibility checks a projection must pass before it ships
 * (CLAUDE.md rule 3). Pure and unit-tested.
 */
export function checkProjection(p: ProjectionInputs): ProjectionCheck {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (p.impliedMarketSharePct > 100) {
    failures.push(`Implied market share ${p.impliedMarketSharePct}% exceeds 100% of the market.`);
  } else if (p.impliedMarketSharePct > 40) {
    warnings.push(
      `Implied market share ${p.impliedMarketSharePct}% is very high for a challenger — pressure-test the TAM.`,
    );
  }

  if (p.impliedHeadcount <= 0 || !Number.isFinite(p.impliedHeadcount)) {
    failures.push("Implied headcount is non-positive or undefined.");
  } else if (p.currentHeadcount !== undefined && p.impliedHeadcount > p.currentHeadcount * 10) {
    warnings.push(
      `Implied headcount (${Math.round(p.impliedHeadcount)}) is >10x current (${p.currentHeadcount}) — hiring feasibility is a risk.`,
    );
  }

  if (p.impliedCapitalNeed < 0 || !Number.isFinite(p.impliedCapitalNeed)) {
    failures.push("Implied capital need is negative or undefined.");
  }

  return { ok: failures.length === 0, failures, warnings };
}
