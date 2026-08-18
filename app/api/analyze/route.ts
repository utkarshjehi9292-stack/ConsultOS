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
          ? "GOOGLE_API_KEY is missing or invalid. Add it to .env.local."
          : err.status === 429
            ? "Gemini quota exceeded for this key/model. gemini-3.1-pro-preview needs billing enabled; set CONSULTOS_ANALYSIS_MODEL=gemini-3.7-flash to run on the free tier."
            : `Gemini error: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    if (err instanceof AnalyzeError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return new NextResponse(err instanceof Error ? err.message : "Analysis failed.", { status: 500 });
  }
}
