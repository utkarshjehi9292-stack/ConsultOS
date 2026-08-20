"use client";

import { useState } from "react";

export function RunNow({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist/${token}/run`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Check failed");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
      >
        {busy ? "Checking… (a minute)" : "Check now"}
      </button>
      {error && <span className="text-xs text-flag">{error}</span>}
    </span>
  );
}
