import { NextResponse } from "next/server";
import { createWatchlist } from "../../../db/store";

export const runtime = "nodejs";

// Create a watchlist for a company (anonymous, URL-token identified — no auth in v1).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const companyName = typeof b.companyName === "string" ? b.companyName.trim() : "";
  if (!companyName) return new NextResponse("companyName is required", { status: 400 });
  const { token } = createWatchlist({
    companyName,
    cin: typeof b.cin === "string" && b.cin ? b.cin : null,
    note: typeof b.note === "string" && b.note ? b.note : null,
  });
  return NextResponse.json({ token });
}
