import { NextResponse } from "next/server";
import { getWatchlist } from "../../../../../db/store";
import { runWatchlist } from "../../../../../lib/watchlist";

export const runtime = "nodejs";
export const maxDuration = 300;

// Run one watchlist immediately (a grounded search + structured extract + diff).
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const wl = getWatchlist(token);
  if (!wl) return new NextResponse("Watchlist not found", { status: 404 });
  const r = await runWatchlist(token, wl.companyName);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ added: r.added.length, total: r.total });
}
