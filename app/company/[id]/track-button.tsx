"use client";

import { useState } from "react";

export function TrackButton({ companyName }: { companyName: string }) {
  const [busy, setBusy] = useState(false);

  async function track() {
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName }),
      });
      const { token } = (await res.json()) as { token: string };
      window.location.href = `/watchlist/${token}`;
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={track}
      disabled={busy}
      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
    >
      {busy ? "Setting up…" : "Track weekly →"}
    </button>
  );
}
