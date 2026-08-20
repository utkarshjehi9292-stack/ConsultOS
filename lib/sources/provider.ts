// Company-data provider abstraction (Milestone 3).
//
// The spec: "MCA/RoC data via a provider API (Probe42, Tofler API, or SETU) —
// abstract behind a CompanyDataProvider interface so providers are swappable",
// and rule 4 of the system prompt: "If a company data API tool is available,
// call it before writing the profile; never write a profile from memory alone."
//
// One adapter file per provider implements this interface. The Probe42 adapter
// is wired below (enabled when PROBE42_API_KEY is set); otherwise this returns
// null and the pipeline uses web research only.

import { makeProbe42Provider } from "./probe42";

export interface RegistryFinancial {
  period: string; // e.g. "FY23"
  metric: string; // e.g. "revenue"
  value: string; // verbatim, e.g. "₹42.1 Cr"
}

export interface RegistryData {
  cin: string | null;
  legalName: string | null;
  incorporationDate: string | null; // ISO or as filed
  registeredOffice: string | null;
  directors: string[];
  status: string | null; // "active" | "struck-off" | ...
  financials: RegistryFinancial[];
  /** Provenance URL for the record — becomes a citation in the profile. */
  sourceUrl: string;
}

export interface CompanyDataProvider {
  readonly name: string; // e.g. "Probe42"
  lookup(query: { name: string; cin?: string | null }): Promise<RegistryData | null>;
}

/**
 * Resolve the configured provider, or null when none is wired. A real adapter
 * (Probe42 / Tofler / SETU) is selected here by env, keeping the call site clean.
 * Add more adapters by importing their factory and returning the first that
 * resolves.
 */
export function getCompanyDataProvider(): CompanyDataProvider | null {
  return makeProbe42Provider();
}
