// Runs every prompt against every engine, records each answer in the ledger,
// and summarises how often the brand and its competitors show up.

import { randomUUID } from "node:crypto";
import type { Ledger } from "../ledger/db.ts";
import type { CmoConfig } from "./config.ts";
import { detect, type Detection } from "./detect.ts";
import type { Answer } from "./engines.ts";

export type AskFn = (engine: string, prompt: string) => Promise<Answer>;

export interface CheckResult {
  engine: string;
  prompt: string;
  detection?: Detection;
  error?: string;
  costUsd?: number;
}

export interface Summary {
  runId: string;
  results: CheckResult[];
  /** Per engine and overall: share of answers that cited or mentioned each name. */
  shareOfVoice: Array<{ name: string; engine: string; cited: number; mentioned: number; answers: number }>;
  costUsd: number;
}

export async function runCitations(
  config: CmoConfig,
  ask: AskFn,
  ledger: Ledger,
  opts: { concurrency?: number; onResult?: (r: CheckResult) => void } = {},
): Promise<Summary> {
  const runId = randomUUID();
  const jobs = config.engines.flatMap((engine) =>
    config.prompts.flatMap((prompt) => Array.from({ length: config.runs }, () => ({ engine, prompt }))),
  );
  const results: CheckResult[] = [];

  await pool(jobs, opts.concurrency ?? 4, async ({ engine, prompt }) => {
    let result: CheckResult;
    try {
      const answer = await ask(engine, prompt);
      const detection = detect(answer.text, answer.sources, config.brand, config.competitors);
      ledger.recordCitation({
        runId,
        checkedAt: new Date().toISOString(),
        engine,
        prompt,
        cited: detection.cited,
        mentioned: detection.mentioned,
        citedUrls: detection.citedUrls,
        competitors: detection.competitors,
        answer: answer.text,
        sources: answer.sources,
        ...(answer.costUsd !== undefined && { costUsd: answer.costUsd }),
      });
      result = { engine, prompt, detection, ...(answer.costUsd !== undefined && { costUsd: answer.costUsd }) };
    } catch (err) {
      result = { engine, prompt, error: err instanceof Error ? err.message : String(err) };
    }
    results.push(result);
    opts.onResult?.(result);
  });

  return { runId, results, shareOfVoice: shareOfVoice(config, results), costUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) };
}

function shareOfVoice(config: CmoConfig, results: CheckResult[]): Summary["shareOfVoice"] {
  const names = [config.brand.name, ...config.competitors.map((c) => c.name)];
  const rows: Summary["shareOfVoice"] = [];
  for (const engine of [...config.engines, "all"]) {
    const answered = results.filter((r) => r.detection && (engine === "all" || r.engine === engine));
    for (const name of names) {
      const hits = answered.map((r) => (name === config.brand.name ? r.detection! : r.detection!.competitors.find((c) => c.name === name)!));
      rows.push({
        name,
        engine,
        answers: answered.length,
        cited: hits.filter((h) => h.cited).length,
        mentioned: hits.filter((h) => h.cited || h.mentioned).length,
      });
    }
  }
  return rows;
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    }),
  );
}
