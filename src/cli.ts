#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./cite/config.ts";
import { runCitations, type CheckResult } from "./cite/run.ts";
import { Ledger } from "./ledger/db.ts";
import { SiteMap } from "./map/locate.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const program = new Command("cmo").description("Dependabot for AI search");

program
  .command("locate")
  .description("Show which source files render each URL")
  .argument("<urls...>", "URLs or paths, e.g. https://example.com/blog/post or /pricing")
  .option("-r, --root <dir>", "site repository root", ".")
  .action((urls: string[], opts: { root: string }) => {
    const site = new SiteMap(resolve(opts.root));
    const results = urls.map((url) => site.locate(url) ?? { url, page: null });
    console.log(JSON.stringify({ siteFiles: site.siteFiles(), results }, null, 2));
  });

program
  .command("routes")
  .description("List every route cmo found, most specific first")
  .option("-r, --root <dir>", "site repository root", ".")
  .action((opts: { root: string }) => {
    for (const route of new SiteMap(resolve(opts.root)).routes) {
      const path = route.segments
        .map((s) => (s.type === "static" ? s.value : s.type === "dynamic" ? `:${s.name}` : `*${s.name}${s.optional ? "?" : ""}`))
        .join("/");
      console.log(`/${path}\t${route.file}`);
    }
  });

program
  .command("cite")
  .description("Ask AI engines your prompts with web search on, and record whether they cite you")
  .option("-c, --config <file>", "config with brand, competitors, prompts and engines", "cmo.config.json")
  .option("--db <file>", "ledger database", ".cmo/ledger.db")
  .option("-e, --engines <ids...>", "override the engines in the config")
  .option("-n, --runs <n>", "times to ask each engine each prompt", (v) => Number.parseInt(v, 10))
  .option("--json", "print the full summary as JSON")
  .action(async (opts: { config: string; db: string; engines?: string[]; runs?: number; json?: boolean }) => {
    const config = loadConfig(opts.config);
    if (opts.engines) config.engines = opts.engines;
    if (opts.runs) config.runs = opts.runs;
    const { ask, hasCredentials } = await import("./cite/engines.ts");
    const skipped = config.engines.filter((e) => !hasCredentials(e));
    config.engines = config.engines.filter(hasCredentials);
    if (skipped.length) console.error(`Skipping ${skipped.join(", ")}: set AI_GATEWAY_API_KEY, or the provider's own API key.`);
    if (config.engines.length === 0) process.exit(1);
    mkdirSync(dirname(resolve(opts.db)), { recursive: true });
    const ledger = new Ledger(opts.db);
    const total = config.engines.length * config.prompts.length * config.runs;
    let done = 0;
    const summary = await runCitations(config, ask, ledger, {
      onResult: (r) => !opts.json && console.error(`[${++done}/${total}] ${mark(r)} ${r.engine}  ${r.prompt}${r.error ? `  (${r.error})` : ""}`),
    });
    ledger.close();
    if (opts.json) return console.log(JSON.stringify(summary, null, 2));

    console.log(`\nShare of voice (cited / named, out of answers)  run ${summary.runId}`);
    for (const engine of [...config.engines, "all"]) {
      console.log(`\n  ${engine}`);
      for (const row of summary.shareOfVoice.filter((r) => r.engine === engine)) {
        console.log(`    ${row.name.padEnd(24)} cited ${row.cited}/${row.answers}   named ${row.mentioned}/${row.answers}`);
      }
    }
    const failed = summary.results.filter((r) => r.error).length;
    console.log(`\n${failed ? `${failed} checks failed. ` : ""}Cost: ${summary.results.some((r) => r.costUsd !== undefined) ? `$${summary.costUsd.toFixed(4)}` : "not reported (direct provider keys)"}  Ledger: ${opts.db}`);
  });

program
  .command("audit")
  .description("Check a live site for what keeps AI engines from reading and citing it")
  .argument("<site>", "site URL, e.g. https://example.com")
  .option("-r, --root <dir>", "site repository root, to name the files each fix touches")
  .option("-u, --urls <urls...>", "audit these pages instead of sampling the sitemap")
  .option("-l, --limit <n>", "pages to sample from the sitemap", (v) => Number.parseInt(v, 10), 20)
  .option("--json", "print findings as JSON")
  .action(async (siteUrl: string, opts: { root?: string; urls?: string[]; limit: number; json?: boolean }) => {
    const [{ snapshot }, { audit }] = await Promise.all([import("./audit/fetch.ts"), import("./audit/checks.ts")]);
    const snap = await snapshot(siteUrl, { limit: opts.limit, ...(opts.urls && { urls: opts.urls }) });
    const findings = audit(snap, opts.root ? new SiteMap(resolve(opts.root)) : undefined);
    if (opts.json) return console.log(JSON.stringify(findings, null, 2));

    const order = { error: 0, warn: 1, info: 2 } as const;
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
    console.log(`Audited ${snap.pages.length} pages on ${snap.origin}\n`);
    for (const f of findings) {
      console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.id.padEnd(26)} ${new URL(f.url).pathname}`);
      console.log(`      ${f.message}`);
      if (f.files.length) console.log(`      → ${f.files.join(", ")}`);
    }
    const count = (s: string) => findings.filter((f) => f.severity === s).length;
    console.log(`\n${count("error")} errors, ${count("warn")} warnings, ${count("info")} notes`);
    if (count("error")) process.exitCode = 1;
  });

function mark(r: CheckResult): string {
  if (r.error) return "!";
  return r.detection!.cited ? "✓" : r.detection!.mentioned ? "~" : "·";
}

program.parse();
