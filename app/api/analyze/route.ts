import { NextResponse } from "next/server";
import { runSwotAnalysis, AnalyzeError } from "../../../lib/analyze";
import { GeminiError } from "../../../lib/providers/gemini";
import type { CompanyInput } from "../../../prompts/tasks";

export const runtime = "nodejs";
// Research + two analysis calls can take a while; give it room.
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return new NextResponse("Company name is required.", { status: 400 });

  const input: CompanyInput = {
    name,
    website: typeof b.website === "string" && b.website ? b.website : null,
    cin: typeof b.cin === "string" && b.cin ? b.cin : null,
    region: typeof b.region === "string" && b.region ? b.region : null,
    notes: typeof b.notes === "string" && b.notes ? b.notes : null,
  };

  try {
    const out = await runSwotAnalysis(input);
    return NextResponse.json({
      companyId: out.companyId,
      analysisId: out.analysisId,
      lowConfidence: out.lowConfidence,
    });
  } catch (err) {
    if (err instanceof GeminiError) {
      const msg =
        err.status === 401
          ? "GOOGLE_API_KEY is missing or invalid."
          : err.status === 429
            ? "Gemini free-tier quota exhausted — this includes a small daily Google-Search grounding quota used by the research step. Wait for it to reset (per-minute limits recover in ~1 min; daily limits reset once a day), or enable billing on the Google Cloud project for higher limits (billing also unblocks gemini-3.1-pro-preview for analysis)."
            : err.status === 503
              ? "Gemini is temporarily overloaded. Try again in a moment."
              : `Gemini error: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: err.status === 503 ? 503 : 502 });
    }
    if (err instanceof AnalyzeError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return new NextResponse(err instanceof Error ? err.message : "Analysis failed.", { status: 500 });
  }
}
