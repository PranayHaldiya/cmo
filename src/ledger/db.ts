// The attribution ledger: citation checks and Search Console snapshots over
// time, plus every PR cmo opened, so we can ask "did this merge move anything?"

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS citation_checks (
  id          INTEGER PRIMARY KEY,
  run_id      TEXT NOT NULL DEFAULT '',
  checked_at  TEXT NOT NULL,
  engine      TEXT NOT NULL,         -- AI Gateway model id, e.g. "perplexity/sonar"
  prompt      TEXT NOT NULL,
  cited       INTEGER NOT NULL,      -- 1 if one of our URLs was a source
  mentioned   INTEGER NOT NULL DEFAULT 0,
  cited_urls  TEXT NOT NULL DEFAULT '[]',
  competitors TEXT NOT NULL DEFAULT '[]',
  answer      TEXT NOT NULL DEFAULT '',
  sources     TEXT NOT NULL DEFAULT '[]',
  cost_usd    REAL
);
CREATE TABLE IF NOT EXISTS gsc_daily (
  date        TEXT NOT NULL,
  page        TEXT NOT NULL,
  clicks      INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position    REAL,
  PRIMARY KEY (date, page)
);
CREATE TABLE IF NOT EXISTS fixes (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,          -- e.g. "llms-txt", "json-ld", "meta-description"
  url        TEXT NOT NULL,
  files      TEXT NOT NULL,          -- JSON array of repo paths touched
  pr_url     TEXT,
  opened_at  TEXT NOT NULL,
  merged_at  TEXT
);
CREATE INDEX IF NOT EXISTS citation_checks_by_time ON citation_checks (checked_at);
`;

export interface CitationCheck {
  runId?: string;
  checkedAt: string;
  engine: string;
  prompt: string;
  cited: boolean;
  mentioned?: boolean;
  citedUrls?: string[];
  competitors?: unknown[];
  answer?: string;
  sources?: string[];
  costUsd?: number;
}

export interface Window {
  checks: number;
  citationRate: number;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  recordCitation(c: CitationCheck): void {
    this.db
      .prepare(
        `INSERT INTO citation_checks (run_id, checked_at, engine, prompt, cited, mentioned, cited_urls, competitors, answer, sources, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.runId ?? "",
        c.checkedAt,
        c.engine,
        c.prompt,
        c.cited ? 1 : 0,
        c.mentioned ? 1 : 0,
        JSON.stringify(c.citedUrls ?? []),
        JSON.stringify(c.competitors ?? []),
        c.answer ?? "",
        JSON.stringify(c.sources ?? []),
        c.costUsd ?? null,
      );
  }

  recordFix(fix: { kind: string; url: string; files: string[]; prUrl?: string; openedAt: string }): number {
    const result = this.db
      .prepare("INSERT INTO fixes (kind, url, files, pr_url, opened_at) VALUES (?, ?, ?, ?, ?)")
      .run(fix.kind, fix.url, JSON.stringify(fix.files), fix.prUrl ?? null, fix.openedAt);
    return Number(result.lastInsertRowid);
  }

  markMerged(fixId: number, mergedAt: string): void {
    this.db.prepare("UPDATE fixes SET merged_at = ? WHERE id = ?").run(mergedAt, fixId);
  }

  /** Citation rate in [from, to). */
  citationWindow(from: string, to: string): Window {
    const row = this.db
      .prepare("SELECT COUNT(*) AS checks, COALESCE(AVG(cited), 0) AS rate FROM citation_checks WHERE checked_at >= ? AND checked_at < ?")
      .get(from, to) as { checks: number; rate: number };
    return { checks: row.checks, citationRate: row.rate };
  }

  /** Citation rate for `days` before and after a fix was merged. */
  fixImpact(fixId: number, days = 14): { before: Window; after: Window } | null {
    const fix = this.db.prepare("SELECT merged_at FROM fixes WHERE id = ?").get(fixId) as { merged_at: string | null } | undefined;
    if (!fix?.merged_at) return null;
    const merged = new Date(fix.merged_at).getTime();
    const shift = (d: number) => new Date(merged + d * 86_400_000).toISOString();
    return { before: this.citationWindow(shift(-days), fix.merged_at), after: this.citationWindow(fix.merged_at, shift(days)) };
  }

  close(): void {
    this.db.close();
  }
}
