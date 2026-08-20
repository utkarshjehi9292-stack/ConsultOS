import { describe, expect, it } from "vitest";
import { diffSignals, signalKey, toSignals, type Signal } from "./signals";

const sig = (over: Partial<Signal> = {}): Signal => ({
  headline: "Acme raises Series B",
  category: "funding",
  date: null,
  url: null,
  ...over,
});

describe("signalKey", () => {
  it("normalizes URL (host + path, no trailing slash)", () => {
    expect(signalKey(sig({ url: "https://News.com/a/?x=1" }))).toBe(signalKey(sig({ url: "https://news.com/a/" })));
  });
  it("falls back to normalized headline when no URL", () => {
    expect(signalKey(sig({ headline: "  Acme   raises   B " }))).toBe("acme raises b");
  });
});

describe("diffSignals", () => {
  it("returns only signals new since the previous snapshot", () => {
    const prev = [sig({ url: "https://n.com/a" }), sig({ headline: "old news" })];
    const curr = [
      sig({ url: "https://n.com/a" }), // unchanged
      sig({ url: "https://n.com/b", headline: "new launch", category: "launch" }), // new
    ];
    const d = diffSignals(prev, curr);
    expect(d.added.map((x) => x.headline)).toEqual(["new launch"]);
    expect(d.unchangedCount).toBe(1);
  });

  it("dedupes within the current batch", () => {
    const curr = [sig({ url: "https://n.com/a" }), sig({ url: "https://n.com/a/" })];
    expect(diffSignals([], curr).added).toHaveLength(1);
  });

  it("everything is new on the first run (empty prev)", () => {
    const curr = [sig(), sig({ headline: "x", url: "https://n.com/x" })];
    expect(diffSignals([], curr).added).toHaveLength(2);
  });
});

describe("toSignals", () => {
  it("maps and defaults category to other; drops empty headlines", () => {
    const out = toSignals({
      signals: [
        { headline: "Funding round", category: "funding", url: "https://x/a", date: "2026-08-01" },
        { headline: "weird", category: "bogus" },
        { headline: "", category: "news" },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.category).toBe("funding");
    expect(out[1]!.category).toBe("other");
  });
});
