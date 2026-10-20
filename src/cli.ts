#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { SiteMap } from "./map/locate.ts";

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

program.parse();
