// SQLite connection (better-sqlite3 + Drizzle) for local dev. Production target
// is Supabase Postgres — the schema is written to port cleanly (see README).
// Idempotent DDL so a fresh checkout runs with no migration step.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DB_PATH =
  process.env.CONSULTOS_DB_PATH ?? (process.env.VERCEL || process.env.RENDER ? "/tmp/consultos.db" : "./consultos.db");

// Lazy singleton — opened on first query, NOT at import time. Opening at import
// makes `next build`'s page-data collection touch the DB (and lock it).
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb(): ReturnType<typeof drizzle> {
  if (_db) return _db;
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cin TEXT,
    website TEXT,
    region TEXT,
    sector TEXT,
    profile_json TEXT NOT NULL,
    sources_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    type TEXT NOT NULL,
    input_snapshot TEXT NOT NULL,
    output_json TEXT NOT NULL,
    confidence_band TEXT NOT NULL,
    low_confidence INTEGER NOT NULL DEFAULT 0,
    model_version TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    stage TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    thought_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS watchlists (
    token TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    cin TEXT,
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_run_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS watchlist_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_token TEXT NOT NULL REFERENCES watchlists(token),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    signals_json TEXT NOT NULL,
    added_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analyses_company ON analyses(company_id);
  CREATE INDEX IF NOT EXISTS idx_llm_calls_analysis ON llm_calls(analysis_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_watchlist ON watchlist_snapshots(watchlist_token);
`);
  _db = drizzle(sqlite, { schema });
  return _db;
}

export { schema };
