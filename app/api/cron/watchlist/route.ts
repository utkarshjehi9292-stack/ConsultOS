import { NextResponse } from "next/server";
import { runDueWatchlists } from "../../../../lib/watchlist";

export const runtime = "nodejs";
export const maxDuration = 300;

// Weekly digest job: refresh every due watchlist and store the diff.
// Schedule this with a Render Cron Job or a scheduled GitHub Action that POSTs
// here weekly with the `x-cron-secret` header (see README).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const results = await runDueWatchlists();
  return NextResponse.json({
    ran: results.length,
    results: results.map((r) => ({
      company: r.companyName,
      newSignals: r.added.length,
      total: r.total,
      ...(r.error ? { error: r.error } : {}),
    })),
  });
}
