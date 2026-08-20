"use client";

import { useState } from "react";

const ANALYSIS_MODELS = [
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash — free tier (recommended)" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro preview — needs billing" },
];

const RESEARCH_PROVIDERS = [
  { id: "gemini", label: "Gemini + Google Search — free" },
  { id: "claude-agent", label: "Claude Agent SDK — needs ANTHROPIC_API_KEY" },
];

const MODULES = [
  { id: "swot", label: "SWOT analysis" },
  { id: "growth", label: "Growth opportunities (Ansoff)" },
  { id: "valuechain", label: "Value chain diagnostic" },
  { id: "competition", label: "Competitive radar" },
  { id: "memo", label: "Consultant's memo" },
];

export function IntakeForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [cin, setCin] = useState("");
  const [region, setRegion] = useState("India");
  const [notes, setNotes] = useState("");
  const [module, setModule] = useState("swot");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [research, setResearch] = useState("gemini");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: website.trim() || null,
          cin: cin.trim() || null,
          region: region.trim() || null,
          notes: notes.trim() || null,
          module,
          analysisModel: model,
          researchProvider: research,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { companyId } = (await res.json()) as { companyId: string };
      window.location.href = `/company/${companyId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Company name <span className="text-flag">*</span>
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Rare Beauty Brands Pvt Ltd"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="website" className="block text-sm font-medium text-ink">
            Website <span className="text-ink/40">(optional)</span>
          </label>
          <input
            id="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="cin" className="block text-sm font-medium text-ink">
            CIN <span className="text-ink/40">(optional)</span>
          </label>
          <input
            id="cin"
            value={cin}
            onChange={(e) => setCin(e.target.value)}
            placeholder="U74999KA2019PTC…"
            className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          />
        </div>
      </div>
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-ink">
          Anything specific to look at? <span className="text-ink/40">(optional)</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. considering entering quick-commerce; worried about CAC"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="module" className="block text-sm font-medium text-ink">
          Analysis module
        </label>
        <select
          id="module"
          value={module}
          onChange={(e) => setModule(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        >
          {MODULES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="model" className="block text-sm font-medium text-ink">
          Analysis model
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        >
          {ANALYSIS_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink/50">
          Pro preview needs billing on the Google project. If it hits its quota, the analysis
          automatically falls back to Flash.
        </p>
      </div>
      <div>
        <label htmlFor="research" className="block text-sm font-medium text-ink">
          Research provider
        </label>
        <select
          id="research"
          value={research}
          onChange={(e) => setResearch(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
        >
          {RESEARCH_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink/50">
          The Agent SDK runs an autonomous web-research loop; it needs an ANTHROPIC_API_KEY on the
          server, otherwise it falls back to Gemini grounding.
        </p>
      </div>
      {error && (
        <p className="rounded-md bg-flag/10 px-3 py-2 text-sm text-flag" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-50"
      >
        {busy
          ? "Researching & analysing… (this takes a minute)"
          : `Run ${MODULES.find((m) => m.id === module)?.label ?? "analysis"}`}
      </button>
    </form>
  );
}
