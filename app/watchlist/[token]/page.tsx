import { getWatchlist, latestSnapshot } from "../../../db/store";
import type { Signal } from "../../../lib/signals";
import { RunNow } from "./run-now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAT_LABEL: Record<Signal["category"], string> = {
  funding: "Funding",
  launch: "Launch",
  leadership: "Leadership",
  mna: "M&A",
  news: "News",
  other: "News",
};

export default async function WatchlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const wl = getWatchlist(token);
  if (!wl) {
    return <main className="mx-auto max-w-2xl px-5 py-20 text-center text-ink/70">This watchlist link isn’t valid.</main>;
  }
  const snap = latestSnapshot(token);

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-fact">Watchlist</p>
      <h1 className="mt-1 font-serif text-3xl text-ink">{wl.companyName}</h1>
      <p className="mt-2 text-sm text-ink/60">
        Weekly digest of funding, launches, leadership, M&amp;A, and news. The digest is what’s
        <em> new</em> since the last check.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <RunNow token={token} />
        <span className="text-xs text-ink/50">
          {wl.lastRunAt ? `Last checked ${new Date(wl.lastRunAt * 1000).toLocaleString()}` : "Not checked yet"}
        </span>
      </div>

      {!snap ? (
        <p className="mt-8 rounded-md border border-line bg-white p-4 text-sm text-ink/60">
          No digest yet. Click “Check now”, or the weekly job will populate it.
        </p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="font-serif text-xl text-ink">New since last check ({snap.added.length})</h2>
            {snap.added.length === 0 ? (
              <p className="mt-1 text-sm text-ink/50">Nothing new this run.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {snap.added.map((s, i) => (
                  <SignalRow key={i} sig={s} highlight />
                ))}
              </ul>
            )}
          </section>
          <section className="mt-8">
            <details>
              <summary className="cursor-pointer font-serif text-lg text-ink">
                All current signals ({snap.signals.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {snap.signals.map((s, i) => (
                  <SignalRow key={i} sig={s} />
                ))}
              </ul>
            </details>
          </section>
        </>
      )}
      <p className="mt-10 border-t border-line pt-4 text-xs text-ink/40">
        Signals are from public web search and carry a source where available. Strategic monitoring, not advice.
      </p>
    </main>
  );
}

function SignalRow({ sig, highlight }: { sig: Signal; highlight?: boolean }) {
  return (
    <li className={`rounded-md border p-3 text-sm ${highlight ? "border-fact/40 bg-fact/5" : "border-line bg-white"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink">{sig.headline}</span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink/40">{CAT_LABEL[sig.category]}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-ink/50">
        {sig.date && <span>{sig.date}</span>}
        {sig.url && (
          <a href={sig.url} target="_blank" rel="noreferrer" className="text-fact underline">
            source ↗
          </a>
        )}
      </div>
    </li>
  );
}
