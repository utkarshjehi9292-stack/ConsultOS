// Watchlist signals + weekly diff (Milestone 3).
//
// A watchlist periodically captures market "signals" for a company (funding,
// launches, leadership, M&A, news) and the digest is the DIFF against the last
// snapshot — only what's new. The schema + diff are pure and unit-tested; the
// capture (grounded search + structured extract) lives in lib/watchlist.ts.

import { z } from "zod";

export const SignalCategory = z.enum(["funding", "launch", "leadership", "mna", "news", "other"]);

export const SignalSchema = z.object({
  headline: z.string().min(1),
  category: SignalCategory,
  date: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
});
export type Signal = z.infer<typeof SignalSchema>;

/** Gemini response schema for the signals extract step (flat, JSON-mode). */
export const geminiSignalsSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          category: { type: "string", enum: ["funding", "launch", "leadership", "mna", "news", "other"] },
          date: { type: "string", nullable: true },
          url: { type: "string", nullable: true },
        },
        required: ["headline", "category"],
      },
    },
  },
  required: ["signals"],
};

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function sn(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function toSignals(raw: unknown): Signal[] {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(o.signals) ? o.signals : [];
  return arr
    .map((x) => {
      const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      const catRaw = s(r.category);
      const category = (["funding", "launch", "leadership", "mna", "news", "other"].includes(catRaw)
        ? catRaw
        : "other") as Signal["category"];
      return { headline: s(r.headline), category, date: sn(r.date), url: sn(r.url) };
    })
    .filter((x) => x.headline.length > 0);
}

/** Stable identity for a signal — prefer the URL, else a normalized headline. */
export function signalKey(sig: Signal): string {
  if (sig.url) {
    try {
      const u = new URL(sig.url);
      return `${u.host.toLowerCase()}${u.pathname}`.replace(/\/+$/, "");
    } catch {
      /* fall through */
    }
  }
  return sig.headline.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface SignalDiff {
  added: Signal[]; // new since the previous snapshot — this is the digest
  unchangedCount: number;
}

/** What's new in `curr` vs `prev` (by signal key). Pure. */
export function diffSignals(prev: Signal[], curr: Signal[]): SignalDiff {
  const prevKeys = new Set(prev.map(signalKey));
  const added: Signal[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  for (const sig of curr) {
    const k = signalKey(sig);
    if (seen.has(k)) continue;
    seen.add(k);
    if (prevKeys.has(k)) unchanged++;
    else added.push(sig);
  }
  return { added, unchangedCount: unchanged };
}
