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
