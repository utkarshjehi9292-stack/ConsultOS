import { getLatestAnalysis } from "../../../db/store";
import type { Claim, GrowthResult, MemoResult, Opportunity, StoredResult } from "../../../lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANSOFF_LABEL: Record<Opportunity["ansoff"], string> = {
  market_penetration: "Market penetration",
  market_development: "Market development",
  product_development: "Product development",
  diversification: "Diversification",
};

const MODULE_LABEL: Record<StoredResult["module"], string> = {
  swot: "SWOT analysis",
  growth: "Growth opportunities",
  memo: "Consultant's memo",
};

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = getLatestAnalysis(id);
  if (!found) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center text-ink/70">
        No analysis found for this company.
      </main>
    );
  }
  const result = found.result;
  const { company, confidence, notInData, sources, provenance } = result;

  const bandColor =
    confidence.band === "high" ? "text-fact" : confidence.band === "low" ? "text-flag" : "text-reading";

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="border-b border-line pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fact">{MODULE_LABEL[result.module]}</p>
        <h1 className="mt-1 font-serif text-3xl leading-tight text-ink">{company.name}</h1>
        <p className="mt-2 text-ink/70">{company.oneLiner}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/60">
          {company.sector && <span>{company.sector}</span>}
          {company.founded && <span>Founded {company.founded}</span>}
          {company.hq && <span>{company.hq}</span>}
          <span className={bandColor}>
            Confidence {confidence.band} · {confidence.coveragePct}% cited · {confidence.sourceCount} sources
          </span>
        </div>
        {confidence.band === "low" && (
          <p className="mt-3 rounded-md bg-flag/10 p-3 text-sm text-flag">
            Data coverage is thin — treat everything below as directional, not verified. A second pass with a
            company-data API (MCA/Tofler) would raise confidence.
          </p>
        )}
        <p className="mt-3 text-xs text-ink/40">
          Research via {provenance.researchProvider === "claude-agent" ? "Claude Agent SDK (web search)" : "Gemini + Google Search"} ·
          analysis {provenance.analysisModel} · {new Date(provenance.generatedAt).toLocaleString()}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-ink">Financials</h2>
        {company.financials.status === "unavailable" ? (
          <p className="mt-1 text-sm text-ink/60">
            Not available in sources. Obtain via MCA filings / Tofler / a credit-rating rationale.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink">
            {company.financials.figure} <span className="text-ink/50">— {company.financials.method}</span>
          </p>
        )}
      </section>

      {result.module === "swot" && <SwotView swot={result.swot} facts={company.facts} />}
      {result.module === "growth" && <GrowthView growth={result.growth} facts={company.facts} />}
      {result.module === "memo" && <MemoView memo={result.memo} />}

      {notInData.length > 0 && (
        <section className="mt-10 rounded-md border border-line bg-white p-4">
          <h2 className="font-serif text-lg text-ink">Not in the data</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/70">
            {notInData.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-ink">Sources</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-fact underline">
                  {s.title}
                </a>
                {s.date && <span className="text-ink/40"> · {s.date}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="mt-10 border-t border-line pt-4 text-xs text-ink/40">
        Strategic analysis, not legal or investment advice. Where a decision needs it, consult a professional.
      </p>
    </main>
  );
}

// --- SWOT --------------------------------------------------------------------

function SwotView({ swot, facts }: { swot: AnalysisSwot; facts: Claim[] }) {
  return (
    <>
      {facts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink">Profile</h2>
          <ul className="mt-3 space-y-2">
            {facts.map((c, i) => (
              <ClaimRow key={i} claim={c} />
            ))}
          </ul>
        </section>
      )}
      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <Quadrant title="Strengths" claims={swot.strengths} />
        <Quadrant title="Weaknesses" claims={swot.weaknesses} />
        <Quadrant title="Opportunities" claims={swot.opportunities} />
        <Quadrant title="Threats" claims={swot.threats} />
      </section>
    </>
  );
}

type AnalysisSwot = { strengths: Claim[]; weaknesses: Claim[]; opportunities: Claim[]; threats: Claim[] };

function Quadrant({ title, claims }: { title: string; claims: Claim[] }) {
  return (
    <div>
      <h3 className="font-serif text-lg text-ink">{title}</h3>
      {claims.length === 0 ? (
        <p className="mt-1 text-sm text-ink/40">Nothing determinable from sources.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {claims.map((c, i) => (
            <ClaimRow key={i} claim={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Growth ------------------------------------------------------------------

function GrowthView({ growth, facts }: { growth: GrowthResult["growth"]; facts: Claim[] }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl text-ink">Growth opportunities (Ansoff)</h2>
      <p className="mt-1 text-sm text-ink/60">
        Ranked by priority = capability adjacency × market attractiveness ÷ execution difficulty.
      </p>
      <div className="mt-4 space-y-4">
        {growth.opportunities.map((o, i) => (
          <article key={i} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-serif text-lg text-ink">{o.title}</h3>
              <div className="flex items-center gap-2 text-xs">
                {o.title === growth.bestThisQuarter && (
                  <span className="rounded bg-fact/15 px-2 py-0.5 font-medium text-fact">Do this quarter</span>
                )}
                <span className="rounded bg-ink/5 px-2 py-0.5 text-ink/60">{ANSOFF_LABEL[o.ansoff]}</span>
                <span className="font-mono text-ink/70">priority {o.priorityScore}</span>
              </div>
            </div>
            <div className="mt-2">
              <ClaimRow claim={{ statement: o.rationale, evidence: o.evidence, confidence: o.confidence }} />
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-ink/70 sm:grid-cols-3">
              <div><span className="font-medium">Adjacency {o.scores.adjacency}/5</span> — {o.scoreReasoning.adjacency}</div>
              <div><span className="font-medium">Attractiveness {o.scores.attractiveness}/5</span> — {o.scoreReasoning.attractiveness}</div>
              <div><span className="font-medium">Difficulty {o.scores.difficulty}/5</span> — {o.scoreReasoning.difficulty}</div>
            </dl>
            {o.scenarios.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Scenarios (ranges, not points)</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {o.scenarios.map((s, j) => (
                    <li key={j}>
                      <span className="font-medium capitalize text-ink">{s.level}:</span> {s.value}{" "}
                      <span className="text-ink/50">— {s.driver}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.sanity && (!o.sanity.ok || o.sanity.warnings.length > 0) && (
              <div className="mt-3 rounded bg-flag/5 p-2 text-xs">
                {o.sanity.failures.map((f, j) => (
                  <p key={"f" + j} className="text-flag">⚠ Sanity check failed: {f}</p>
                ))}
                {o.sanity.warnings.map((w, j) => (
                  <p key={"w" + j} className="text-reading">Note: {w}</p>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      {facts.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-ink/60">Company profile facts ({facts.length})</summary>
          <ul className="mt-2 space-y-2">
            {facts.map((c, i) => (
              <ClaimRow key={i} claim={c} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// --- Memo (Pyramid Principle) ------------------------------------------------

function MemoView({ memo }: { memo: MemoResult["memo"] }) {
  return (
    <section className="mt-8">
      {memo.dataQualityNote && (
        <p className="mb-4 rounded-md bg-reading/10 p-3 text-sm text-reading">{memo.dataQualityNote}</p>
      )}
      <p className="font-serif text-xl leading-snug text-ink">{memo.answer}</p>
      <ol className="mt-4 space-y-2">
        {memo.arguments.map((a, i) => (
          <li key={i} className="text-sm">
            <span className="mr-1 font-medium text-ink/50">{i + 1}.</span>
            <ClaimRow claim={{ statement: a.point, evidence: a.evidence, confidence: a.confidence }} inline />
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-md border-l-2 border-fact bg-fact/5 px-3 py-2 text-sm text-ink">
        <span className="font-medium">Therefore:</span> {memo.therefore.action}{" "}
        <span className="text-ink/60">by {memo.therefore.timeframe}.</span>
      </p>
      <p className="mt-4 text-sm text-ink/50">Confidence: {memo.confidenceOutOf10}/10</p>
    </section>
  );
}

// --- shared: the cite-or-flag claim row --------------------------------------

function ClaimRow({ claim, inline }: { claim: Claim; inline?: boolean }) {
  const cited = claim.evidence.kind === "citation";
  const Tag = inline ? "span" : "li";
  return (
    <Tag className="text-sm leading-relaxed">
      <span className="text-ink">{claim.statement}</span>{" "}
      {cited ? (
        <a
          href={(claim.evidence as { url: string }).url}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap text-xs font-medium text-fact underline"
          title={(claim.evidence as { title: string }).title}
        >
          From platform data ↗
        </a>
      ) : (
        <span
          className="whitespace-nowrap text-xs font-medium text-reading"
          title={(claim.evidence as { note: string }).note}
        >
          [assumption — strategy reading]
        </span>
      )}
      <span className="ml-1 text-[11px] uppercase tracking-wide text-ink/35">· {claim.confidence}</span>
    </Tag>
  );
}
