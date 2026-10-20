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
  .option("--json", "print the full summary as JSON")
  .action(async (opts: { config: string; db: string; engines?: string[]; json?: boolean }) => {
    const config = loadConfig(opts.config);
    if (opts.engines) config.engines = opts.engines;
    const { ask, hasCredentials } = await import("./cite/engines.ts");
    const skipped = config.engines.filter((e) => !hasCredentials(e));
    config.engines = config.engines.filter(hasCredentials);
    if (skipped.length) console.error(`Skipping ${skipped.join(", ")}: set AI_GATEWAY_API_KEY, or the provider's own API key.`);
    if (config.engines.length === 0) process.exit(1);
    mkdirSync(dirname(resolve(opts.db)), { recursive: true });
    const ledger = new Ledger(opts.db);
    const total = config.engines.length * config.prompts.length;
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

function mark(r: CheckResult): string {
  if (r.error) return "!";
  return r.detection!.cited ? "✓" : r.detection!.mentioned ? "~" : "·";
}

program.parse();
