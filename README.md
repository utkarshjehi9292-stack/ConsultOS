# ConsultOS

The **analysis layer** of a senior strategy consultant, for founders who can't afford one. Enter a company; get a **source-cited SWOT** in a few minutes. Every factual claim points at a source or is flagged as an assumption — nothing is estimated without saying so.

See [`CLAUDE.md`](./CLAUDE.md) for the full product spec.

> **Milestone 1** (the spec says "do not skip ahead"): intake form → web-search-backed company profile → **SWOT with citations**, plus the credibility core (Zod schemas + sanity/VERIFY layer, unit-tested first) and `llm_calls` logging from day one.

---

## The hybrid AI layer

Per request, the pipeline is **code-controlled** (not an open-ended agent) — this is the anti-hallucination architecture:

```
RESEARCH  → gather sourced findings
              • Claude Agent SDK (WebSearch/WebFetch)   ← if ANTHROPIC_API_KEY is set
              • else Gemini + Google Search grounding    ← runs on the Google key alone
EXTRACT   → structure findings into a CompanyProfile     (Gemini JSON mode + Zod)
SWOT      → the one analysis module in M1                (Gemini JSON mode + Zod)
VERIFY    → machine gates, then sanitize (never ship a defect)
PERSIST   → companies / analyses / llm_calls
```

Two providers, one abstraction:

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — the agentic research step. Isolated from local Claude config (`settingSources: []`), restricted to read-only web tools, turn-capped. Used when `ANTHROPIC_API_KEY` is present.
- **Google Gemini** (AI Studio, called over its REST contract) — the deterministic extract → SWOT steps, with `responseSchema` JSON output, `temperature: 0`, Zod validation, and retry-with-feedback (max 2).

### VERIFY — the credibility gate (code, not a model)

Enforced in `lib/sanity.ts`, unit-tested first (the spec's priority):

1. **Cite or flag** — every claim is a citation or an explicit assumption (structural, via the Zod discriminated union).
2. **No invented sources** — a cited URL must be one research actually retrieved.
3. **No fabricated financials** — a disclosed figure needs a source, never a guess ("not available in sources" otherwise).
4. **No hedged high-confidence** — "probably/likely/typically" can't ride on `high`.
5. **Confidence** — coverage % + source recency, computed not claimed.
6. **Projection sanity** (Milestone 2, built + tested now) — implied market share / headcount / capital plausibility.

When VERIFY finds a defect it isn't softened — the offending claim is dropped or downgraded (an unverifiable claim becomes a low-confidence assumption) so the stored artifact is always honest.

---

## Models & the free-tier reality

Model IDs live in `lib/models.ts` (env-overridable), verified live against the account:

| Role | Default | Notes |
|---|---|---|
| Analysis (SWOT) | `gemini-3.1-pro-preview` | **Needs billing enabled** — free-tier quota is 0. Until then it 429s. |
| Extraction | `gemini-3.7-flash` | Works on the free tier. |
| Research (Gemini fallback) | `gemini-3.7-flash` | Google Search grounding; has a small daily grounding quota. |
| Research (Agent SDK) | `claude-sonnet-5` | When `ANTHROPIC_API_KEY` is set. |

**To run entirely on the free tier**, point analysis at flash:

```
CONSULTOS_ANALYSIS_MODEL=gemini-3.7-flash
```

`temperature: 0` is honored on Gemini (it accepts sampling params, unlike the current Anthropic models).

---

## Run it

```bash
npm install
cp .env.example .env.local     # then fill in GOOGLE_API_KEY (from aistudio.google.com/apikey)
# optional: ANTHROPIC_API_KEY=sk-ant-...  to enable the Claude Agent SDK research step
npm run dev                    # http://localhost:3000
```

Enter a company on the home page → it researches, analyses, verifies, and redirects to `/company/[id]` with the cited SWOT.

> **Deployment note:** the Claude Agent SDK spawns the Claude Code runtime (a subprocess), and `better-sqlite3` is native — both need a Node server (not an edge runtime); they're marked `serverExternalPackages`. Run on a long-lived Node host.

## Verify

```bash
npm test          # 26 tests — the VERIFY layer + Zod schemas + JSON extraction
npm run typecheck # TypeScript strict
npm run build     # Next.js production build
```

The unit tests are the spec's stated first priority ("unit-test the sanity-check layer and Zod schemas first; these are the product's credibility"). A live run of the deterministic half (EXTRACT → SWOT → VERIFY on `gemini-3.6-flash`) was confirmed end-to-end: the model produced cited facts and standards-compliant threats, and VERIFY correctly rejected a high-confidence assumption.

---

## Modules & watchlists

Five analysis modules, all on the same research → extract → **VERIFY** spine, chosen per analysis:

- **SWOT** · **Growth (Ansoff)** — scored, priority-ranked, scenario ranges, projection sanity · **Value chain** — steps, leaks, biggest-leak · **Competitive radar** — direct/indirect/emerging, incumbent-copy + channel-power threats, recent M&A · **Consultant's memo** — Pyramid Principle.

**Competitor watchlists (weekly diff digest).** `POST /api/watchlist` creates an anonymous, token-identified watchlist for a company (or use "Track weekly" on any report). Each run captures recent market signals (funding / launch / leadership / M&A / news) via grounded search + structured extract, and the digest is the **diff vs the previous snapshot** — only what's new. View at `/watchlist/[token]`, "Check now" to run on demand.

Schedule the weekly job by POSTing to `/api/cron/watchlist` with an `x-cron-secret: $CRON_SECRET` header — via a **Render Cron Job** or a scheduled **GitHub Action** (weekly cron). It refreshes every watchlist due for a run.

**Company-data providers.** `CompanyDataProvider` (`lib/sources/`) abstracts MCA/RoC data; the **Probe42** adapter activates when `PROBE42_API_KEY` is set, enriching the profile with cited registry facts *before* analysis (verify its field paths against Probe42's authenticated docs). No key → web research only.

## Architecture

```
prompts/           versioned prompts (never inlined in routes)
  system.ts          CONSULTANT_SYSTEM — the senior-consultant persona/rules
  tasks.ts           research / extract / SWOT task builders
lib/
  schemas.ts         Zod credibility contract (cite-or-flag is structural)
  sanity.ts          VERIFY gates + confidence + projection sanity (pure, tested)
  extract-json.ts    pull JSON from model prose/fences (pure, tested)
  wire.ts            Gemini flat-output → Zod domain mapping
  models.ts          model registry + provider selection
  providers/
    gemini.ts        Gemini REST provider (structured + grounded), 429/503 backoff
    agent.ts         Claude Agent SDK research provider
  analyze.ts         the orchestrated chain (research → extract → swot → verify → persist)
  telemetry.ts       per-call usage/cost shape
db/
  schema.ts          companies / analyses / llm_calls (SQLite dev; Postgres-portable)
  client.ts          lazy SQLite connection (Supabase Postgres is the prod target)
  store.ts           persistence helpers
app/                 intake form → /api/analyze → /company/[id] report
```

## Conventions

- TypeScript strict; Zod schemas for every AI structured output; reject + retry (max 2) on schema/VERIFY failure.
- All prompts are versioned template functions in `prompts/*.ts`.
- Every model call is logged to `llm_calls` (prompt **hash**, not text — may hold PII; tokens, latency, cost).
- The sanity-check layer and schemas are pure and unit-tested first.

## Not built in v1 (per spec)

No chat interface, no multi-region data, no auth/payments, no scraping. The database is local SQLite for now; the production target is **Supabase Postgres** (the schema is written to port cleanly) — swap when multi-tenant/RLS is needed in Milestone 4.
