// Task prompts, versioned. The persona/rules live in CONSULTANT_SYSTEM; these
// are the per-step instructions and data payloads. Bump the *_VERSION when text
// changes — stored on each analysis for reproducibility.

import type { Citation } from "../lib/schemas";

export interface CompanyInput {
  name: string;
  cin?: string | null;
  website?: string | null;
  notes?: string | null;
  region?: string | null; // e.g. "India"; drives ₹ conventions
}

export const RESEARCH_VERSION = "research@1";
export const EXTRACT_VERSION = "extract@1";
export const SWOT_VERSION = "swot@1";
export const GROWTH_VERSION = "growth@1";
export const MEMO_VERSION = "memo@1";
export const VALUECHAIN_VERSION = "valuechain@1";
export const COMPETITION_VERSION = "competition@1";
export const SIGNALS_VERSION = "signals@1";

/** Grounded search for recent market signals (watchlist digest). */
export function signalsSearchTask(companyName: string): string {
  return `Search the web for RECENT developments about "${companyName}" — in roughly the last 30–45 days. Look for: funding rounds, product launches, leadership changes, mergers/acquisitions, and material news. For each, note what happened, the date if given, and the source. Be strictly factual; skip anything you can't attribute to a source.`;
}

/** Extract the searched text into a structured signal list (JSON mode). */
export function signalsExtractTask(companyName: string, searched: string): string {
  return `From the briefing below about "${companyName}", extract each distinct recent development as a signal: a short factual headline, a category (funding | launch | leadership | mna | news | other), the date if stated, and the source URL if present. Only include items actually supported by the briefing.

BRIEFING:
${searched}`;
}

function companyLine(input: CompanyInput): string {
  const bits = [`Company: ${input.name}`];
  if (input.cin) bits.push(`CIN: ${input.cin}`);
  if (input.website) bits.push(`Website: ${input.website}`);
  if (input.region) bits.push(`Region: ${input.region}`);
  if (input.notes) bits.push(`Founder notes: ${input.notes}`);
  return bits.join("\n");
}

function researchCore(input: CompanyInput): string {
  return `Research the following company using web search. Search before asserting anything time-sensitive (funding, launches, leadership, category). Prefer primary sources (registry filings, company statements, rating rationales) over aggregator blogs, and note when sources conflict.

${companyLine(input)}

Gather only verifiable facts: what the company does, its business model, when/where it was founded, products, customers, funding and financials IF publicly disclosed, and the competitive category. Do NOT infer financials that aren't published — say they are not available in sources. Do not analyse yet; just gather.`;
}

/** Research prompt for the Claude Agent SDK (asks for a structured JSON trailer). */
export function researchTaskAgent(input: CompanyInput): string {
  return `${researchCore(input)}

When done, respond with ONLY a single JSON object and nothing else:
{"findings": "<your factual write-up, with each fact attributable to a source you found>", "sources": [{"url": "<source url>", "title": "<source title>", "date": "<ISO date or null>"}]}
Every URL in "sources" must be one you actually retrieved.`;
}

/** Research prompt for the Gemini grounding fallback (citations come from grounding metadata). */
export function researchTaskGemini(input: CompanyInput): string {
  return `${researchCore(input)}

Write a concise factual briefing. Attribute each fact to where it came from. If a fact is your inference rather than something a source states, mark it [inference]. If something can't be verified, say so.`;
}

function sourceList(sources: Citation[]): string {
  if (sources.length === 0) return "(no sources retrieved — you may not cite any URL; flag facts as [assumption])";
  return sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}${s.date ? ` (${s.date})` : ""}`).join("\n");
}

/** Extract step: structure research findings into a CompanyProfile. Gemini JSON mode. */
export function extractTask(input: CompanyInput, findings: string, sources: Citation[]): string {
  return `Turn the research below into a structured company profile for "${input.name}".

RULES:
- Use ONLY the findings and sources provided. Do not add outside knowledge.
- Cite or flag every fact: set evidenceKind="citation" with the exact sourceUrl (must be one of the URLs listed below), OR evidenceKind="assumption" with an assumptionNote. Never leave a fact ungrounded.
- Financials: set financialsStatus="disclosed" only if a source states a figure — copy it verbatim into financialsFigure and cite it. Otherwise financialsStatus="unavailable". Never estimate an unlabeled figure.
- founded/hq: fill only if a source states them; otherwise leave null. Never infer.
- confidence: "high" only for directly-sourced facts; "medium" for one-step inferences; "low" for weak signals or assumptions.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

RESEARCH FINDINGS:
${findings}`;
}

/** SWOT step: produce a SWOT from the profile + research. Gemini JSON mode. */
export function swotTask(
  input: CompanyInput,
  profileJson: string,
  findings: string,
  sources: Citation[],
): string {
  return `Produce a SWOT analysis for "${input.name}" from the profile and research below.

STANDARDS:
- Max 4 items per quadrant. Each item specific enough to act on ("CAC dependence on Meta ads", not "marketing challenges").
- Every threat item's statement must include a probability note (low/medium/high) and a time horizon.
- Cite or flag every item: evidenceKind="citation" with a sourceUrl from the list below, OR evidenceKind="assumption"/"inference" folded into an assumptionNote. A strength/weakness is often an inference from facts — that's fine, mark it as an assumption with the reasoning, at medium/low confidence.
- Steelman threats: state the strongest real version of why a competitor or incumbent wins.
- Put everything you could NOT determine from the sources into notInData.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

COMPANY PROFILE (JSON):
${profileJson}

RESEARCH FINDINGS:
${findings}`;
}

/** Growth Opportunity Engine — Ansoff-driven, scored, sanity-checked. Gemini JSON mode. */
export function growthTask(
  input: CompanyInput,
  profileJson: string,
  findings: string,
  sources: Citation[],
): string {
  return `Map growth opportunities for "${input.name}" using the Ansoff matrix.

STANDARDS:
- Produce 4–6 opportunities spanning the Ansoff quadrants: market_penetration, market_development, product_development, diversification. Set each item's "ansoff" accordingly.
- Score each on capability adjacency (1–5), market attractiveness (1–5), and execution difficulty (1–5). Give a one-line reason for each score (adjacencyReason / attractivenessReason / difficultyReason). Higher difficulty = harder.
- RANGES, NOT POINTS: for any forward-looking number, provide scenarios as low/base/high, each with the one-line driver assumption behind it (in "scenarios"). Do not state a single point estimate.
- SANITY: if an opportunity implies a growth projection, fill impliedMarketSharePct, impliedHeadcount, and impliedCapitalNeed with the magnitudes it assumes (numbers; use null when not applicable). Be honest — the system will flag implausible implications.
- Cite or flag every rationale: evidenceKind="citation" with a sourceUrl from the list below, or evidenceKind="assumption" with an assumptionNote. Strategy inferences are assumptions at medium/low confidence.
- Do NOT rank or pick the best — the system computes priority as adjacency × attractiveness ÷ difficulty.
- Put anything you could not determine into notInData.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

COMPANY PROFILE (JSON):
${profileJson}

RESEARCH FINDINGS:
${findings}`;
}

/** Consultant's Memo — Pyramid Principle, one page. Gemini JSON mode. */
export function memoTask(
  input: CompanyInput,
  profileJson: string,
  findings: string,
  sources: Citation[],
): string {
  return `Write a one-page consultant's memo for "${input.name}", Pyramid-Principle structured.

STRUCTURE (fill the fields):
- answer: the single most important takeaway, in ONE sentence (answer first, no throat-clearing).
- arguments: up to 3 supporting arguments. Each carries evidenceKind="citation" (with a sourceUrl from the list) or "assumption" (with an assumptionNote), and a confidence.
- thereforeAction + thereforeTimeframe: a specific recommended action and by-when ("Therefore, do X by Y").
- dataQualityNote: if data coverage is thin, lead with that here; otherwise null.
- confidenceOutOf10: your honest confidence 0–10, given the sources.

Write like a sharp colleague. No filler. A founder should be able to forward it without editing.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

COMPANY PROFILE (JSON):
${profileJson}

RESEARCH FINDINGS:
${findings}`;
}

/** Competitive Radar — classify competitors, flag structural threats, recent M&A. Gemini JSON mode. */
export function competitionTask(
  input: CompanyInput,
  profileJson: string,
  findings: string,
  sources: Citation[],
): string {
  return `Map the competitive landscape for "${input.name}". Search for current competitors, funding, launches, and M&A before asserting the state of the market.

STANDARDS:
- List competitors and classify each as direct, indirect, or emerging (set "type").
- For each, describe positioning — steelman how they win, not a strawman — and a threat level (high/medium/low).
- REQUIRED: fill incumbentThreat with the strongest "an incumbent copies this model" threat, and channelPowerThreat with the strongest "a platform/channel that controls distribution squeezes us" threat. If genuinely none, say so explicitly in that field.
- recentMA: note any recent M&A that reprices the space; null if none found.
- Cite or flag every competitor: evidenceKind="citation" with a sourceUrl from the list, or "assumption" with an assumptionNote.
- Put anything you could not determine into notInData.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

COMPANY PROFILE (JSON):
${profileJson}

RESEARCH FINDINGS:
${findings}`;
}

/** Value Chain Diagnostics — map THIS company's actual steps, flag leaks. Gemini JSON mode. */
export function valueChainTask(
  input: CompanyInput,
  profileJson: string,
  findings: string,
  sources: Citation[],
): string {
  return `Map the value chain for "${input.name}" and diagnose where margin leaks.

STANDARDS:
- Map the ACTUAL steps for THIS company from its business model — not a generic textbook chain. Order them from upstream to downstream (e.g. sourcing → production → distribution → sales → support, adapted to what this company actually does).
- For each step: who performs it (performedBy: in-house, a named partner, or a platform), its margin/cost significance (high/medium/low), and the single most likely margin leak or bottleneck at that step (likelyLeak).
- Cite or flag every step's leak: evidenceKind="citation" with a sourceUrl from the list, or "assumption" with an assumptionNote (most leak diagnoses are inferences — mark them as assumptions at medium/low confidence).
- Do NOT pick the biggest leak — the system flags the highest-significance step.
- Put anything you could not determine into notInData.

AVAILABLE SOURCES (cite by exact URL):
${sourceList(sources)}

COMPANY PROFILE (JSON):
${profileJson}

RESEARCH FINDINGS:
${findings}`;
}
