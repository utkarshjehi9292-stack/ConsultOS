// Probe42 adapter for the CompanyDataProvider interface (MCA/RoC data).
//
// ⚠️ Probe42's exact response field paths live behind their authenticated
// developer portal (developer.probe42.in). This adapter targets their documented
// shape — CIN lookup, `x-api-key` + `x-api-version` headers, a base-details
// endpoint returning `data.company` — and maps defensively (missing fields → null)
// so a shape mismatch degrades gracefully instead of crashing. Confirm the field
// paths against the authenticated docs before relying on it in production.
//
// Enabled automatically when PROBE42_API_KEY is set (see provider.ts).

import type { CompanyDataProvider, RegistryData, RegistryFinancial } from "./provider";

const BASE = process.env.PROBE42_BASE ?? "https://api.probe42.in/probe_pro";
const API_VERSION = process.env.PROBE42_API_VERSION ?? "1.3";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function mapFinancials(raw: unknown): RegistryFinancial[] {
  if (!Array.isArray(raw)) return [];
  const out: RegistryFinancial[] = [];
  for (const r of raw) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const period = str(o.financial_year) ?? str(o.year) ?? str(o.period);
    const value = str(o.total_revenue) ?? str(o.revenue) ?? str(o.turnover);
    if (period && value) out.push({ period, metric: "revenue", value });
  }
  return out;
}

class Probe42Provider implements CompanyDataProvider {
  readonly name = "Probe42";
  constructor(private readonly apiKey: string) {}

  async lookup(query: { name: string; cin?: string | null }): Promise<RegistryData | null> {
    // Probe42 keys on CIN; without one we can't do an authoritative lookup.
    if (!query.cin) return null;
    const url = `${BASE}/companies/${encodeURIComponent(query.cin)}/base-details`;
    const res = await fetch(url, {
      headers: { "x-api-key": this.apiKey, "x-api-version": API_VERSION, accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { data?: { company?: Record<string, unknown> } } | null;
    const c = json?.data?.company;
    if (!c) return null;

    const addr = c.registered_address as Record<string, unknown> | undefined;
    const directorsRaw = c.directors ?? c.director_details;
    const directors = Array.isArray(directorsRaw)
      ? directorsRaw
          .map((d) => (d && typeof d === "object" ? str((d as Record<string, unknown>).name) : str(d)))
          .filter((x): x is string => Boolean(x))
      : [];

    return {
      cin: str(c.cin) ?? query.cin,
      legalName: str(c.legal_name) ?? str(c.company_name) ?? query.name,
      incorporationDate: str(c.incorporation_date) ?? str(c.date_of_incorporation),
      registeredOffice: str(addr?.full_address) ?? str(c.registered_office_address),
      directors,
      status: str(c.status) ?? str(c.company_status),
      financials: mapFinancials(c.financials ?? c.financial_details),
      sourceUrl: `https://www.mca.gov.in/ — CIN ${query.cin} (via Probe42)`,
    };
  }
}

export function makeProbe42Provider(): CompanyDataProvider | null {
  const key = process.env.PROBE42_API_KEY;
  return key ? new Probe42Provider(key) : null;
}
