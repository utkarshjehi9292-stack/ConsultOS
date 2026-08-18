import { getLatestAnalysis } from "../../../db/store";
import type { Claim } from "../../../lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const { result } = found;
  const { company, swot, confidence, notInData, sources, provenance } = result;

  const bandColor =
    confidence.band === "high" ? "text-fact" : confidence.band === "low" ? "text-flag" : "text-reading";

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="border-b border-line pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fact">SWOT analysis</p>
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

      {/* Financials — never fabricated */}
      <section className="mt-8">
        <h2 className="font-serif text-xl text-ink">Financials</h2>
        {company.financials.status === "unavailable" ? (
          <p className="mt-1 text-sm text-ink/60">
            Not available in sources. Obtain via MCA filings / Tofler / a credit-rating rationale.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink">
            {company.financials.figure}{" "}
            <span className="text-ink/50">— {company.financials.method}</span>
          </p>
        )}
      </section>

      {/* Profile facts */}
      {company.facts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink">Profile</h2>
          <ul className="mt-3 space-y-2">
            {company.facts.map((c, i) => (
              <ClaimRow key={i} claim={c} />
            ))}
          </ul>
        </section>
      )}

      {/* SWOT */}
      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <Quadrant title="Strengths" claims={swot.strengths} />
        <Quadrant title="Weaknesses" claims={swot.weaknesses} />
        <Quadrant title="Opportunities" claims={swot.opportunities} />
        <Quadrant title="Threats" claims={swot.threats} />
      </section>

      {/* What we couldn't determine — builds trust */}
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

      {/* Sources */}
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

// The core credibility UI: label facts vs readings, and always show the evidence.
function ClaimRow({ claim }: { claim: Claim }) {
  const cited = claim.evidence.kind === "citation";
  return (
    <li className="text-sm leading-relaxed">
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
    </li>
  );
}
