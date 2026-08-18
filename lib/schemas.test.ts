import { describe, expect, it } from "vitest";
import { ClaimSchema, CompanyProfileSchema, SwotSchema } from "./schemas";
import { extractJsonObject } from "./extract-json";

describe("ClaimSchema — cite or flag is structural", () => {
  it("accepts a citation-backed claim", () => {
    const r = ClaimSchema.safeParse({
      statement: "Runs a marketplace.",
      evidence: { kind: "citation", url: "https://x.com/a", title: "T" },
      confidence: "high",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an explicitly-flagged assumption", () => {
    const r = ClaimSchema.safeParse({
      statement: "Team is small.",
      evidence: { kind: "assumption", note: "no data" },
      confidence: "low",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a claim with no evidence at all (no third option)", () => {
    const r = ClaimSchema.safeParse({ statement: "Big company.", confidence: "high" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid confidence enum", () => {
    const r = ClaimSchema.safeParse({
      statement: "x",
      evidence: { kind: "assumption", note: "y" },
      confidence: "very-high",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a citation with a non-URL", () => {
    const r = ClaimSchema.safeParse({
      statement: "x",
      evidence: { kind: "citation", url: "not-a-url", title: "T" },
      confidence: "medium",
    });
    expect(r.success).toBe(false);
  });
});

describe("CompanyProfileSchema", () => {
  it("requires financials to be a valid discriminated union", () => {
    const ok = CompanyProfileSchema.safeParse({
      name: "Acme",
      oneLiner: "A tool.",
      financials: { status: "unavailable" },
    });
    expect(ok.success).toBe(true);

    const bad = CompanyProfileSchema.safeParse({
      name: "Acme",
      oneLiner: "A tool.",
      financials: { status: "disclosed", figure: "₹1Cr" }, // missing method + evidence
    });
    expect(bad.success).toBe(false);
  });

  it("defaults nullable fields and empty facts", () => {
    const r = CompanyProfileSchema.parse({
      name: "Acme",
      oneLiner: "A tool.",
      financials: { status: "unavailable" },
    });
    expect(r.sector).toBeNull();
    expect(r.facts).toEqual([]);
  });
});

describe("SwotSchema", () => {
  it("defaults all quadrants to empty arrays", () => {
    const r = SwotSchema.parse({});
    expect(r).toEqual({ strengths: [], weaknesses: [], opportunities: [], threats: [] });
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a ```json fenced block wrapped in prose", () => {
    const text = 'Here is the result:\n```json\n{"a": [1,2], "b": "}"}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ a: [1, 2], b: "}" });
  });

  it("extracts the first balanced object, ignoring braces inside strings", () => {
    const text = 'noise {"msg": "a } b", "n": 2} trailing {"other": true}';
    expect(extractJsonObject(text)).toEqual({ msg: "a } b", n: 2 });
  });

  it("throws when there is no JSON object", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});
