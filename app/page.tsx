import { IntakeForm } from "./intake-form";

// Structured intake → structured report (CLAUDE.md: no chat interface in v1).
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-fact">ConsultOS</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight text-ink sm:text-4xl">
        The analysis layer of a senior consultant — cited, or it doesn’t ship.
      </h1>
      <p className="mt-4 max-w-prose leading-relaxed text-ink/70">
        Enter a company and get a source-cited SWOT in a few minutes. Every claim
        points at a source or is flagged as an assumption. Nothing is estimated
        without saying so.
      </p>
      <div className="mt-8">
        <IntakeForm />
      </div>
      <p className="mt-6 text-xs text-ink/50">
        Milestone 1: company profile + SWOT, from web search only. Financials are
        never fabricated — if they aren’t public, we say so.
      </p>
    </main>
  );
}
