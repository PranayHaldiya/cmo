// AI-readiness checks over a fetched snapshot of a site. Each finding names the
// source files a fix would touch, when the site's repo is available.

import type { SiteMap } from "../map/locate.ts";
import { readPage } from "./html.ts";
import { AI_SEARCH_BOTS, AI_TRAINING_BOTS, isAllowed, parseRobots } from "./robots.ts";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  url: string;
  message: string;
  /** Repo files to change; `create:` marks a file that doesn't exist yet. */
  files: string[];
}

export interface Fetched {
  status: number;
  text: string;
  contentType?: string;
  xRobotsTag?: string;
}

export interface Snapshot {
  origin: string;
  robots?: Fetched;
  llmsTxt?: Fetched;
  /** URLs listed in the sitemap, or undefined if no sitemap was found. */
  sitemapUrls?: string[];
  pages: Array<{ url: string } & Fetched>;
}

export function audit(snap: Snapshot, site?: SiteMap): Finding[] {
  const files = site?.siteFiles() ?? {};
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "files"> & { files?: Array<string | undefined> }) =>
    findings.push({ ...f, files: (f.files ?? []).filter((x): x is string => Boolean(x)) });
  const root = `${snap.origin}/`;

  if (!snap.llmsTxt || snap.llmsTxt.status !== 200 || /text\/html/i.test(snap.llmsTxt.contentType ?? "")) {
    add({
      id: "llms-txt-missing",
      severity: "warn",
      url: `${snap.origin}/llms.txt`,
      message: "No /llms.txt. It gives AI assistants a short, curated map of your site.",
      files: [files.llmsTxt ?? (site && "create:public/llms.txt")],
    });
  }

  const robots = snap.robots && snap.robots.status < 400 ? parseRobots(snap.robots.text) : undefined;
  if (!robots) {
    add({ id: "robots-missing", severity: "info", url: `${snap.origin}/robots.txt`, message: "No /robots.txt.", files: [files.robots ?? (site && "create:public/robots.txt")] });
  } else {
    const blockedSearch = AI_SEARCH_BOTS.filter((b) => !isAllowed(robots, b));
    const blockedTraining = AI_TRAINING_BOTS.filter((b) => !isAllowed(robots, b));
    if (blockedSearch.length) {
      add({
        id: "robots-blocks-ai-search",
        severity: "error",
        url: `${snap.origin}/robots.txt`,
        message: `robots.txt blocks AI search crawlers that fetch pages to answer questions: ${blockedSearch.join(", ")}. These engines can't cite pages they can't read.`,
        files: [files.robots],
      });
    }
    if (blockedTraining.length) {
      add({
        id: "robots-blocks-ai-training",
        severity: "info",
        url: `${snap.origin}/robots.txt`,
        message: `robots.txt blocks AI training crawlers: ${blockedTraining.join(", ")}. This doesn't stop citations, but models will know less about you.`,
        files: [files.robots],
      });
    }
  }
  if (snap.sitemapUrls === undefined) {
    add({
      id: "sitemap-missing",
      severity: "warn",
      url: `${snap.origin}/sitemap.xml`,
      message: robots?.sitemaps.length ? `The sitemap listed in robots.txt (${robots.sitemaps[0]}) doesn't load.` : "No sitemap at /sitemap.xml or in robots.txt.",
      files: [files.sitemap ?? (site && "create:public/sitemap.xml")],
    });
  }

  for (const page of snap.pages) findings.push(...auditPage(page, page.url === root, site));
  return findings;
}

function auditPage(page: Snapshot["pages"][number], isHome: boolean, site?: SiteMap): Finding[] {
  const loc = site?.locate(page.url) ?? undefined;
  const metaFiles = loc ? [loc.metadataOwner] : [];
  const pageFiles = loc ? [loc.page, ...(loc.content ? [loc.content] : [])] : [];
  const out: Finding[] = [];
  const add = (id: string, severity: Severity, message: string, files: string[]) => out.push({ id, severity, url: page.url, message, files });

  if (page.status >= 400) {
    add("page-error", "error", `Returns HTTP ${page.status}.`, pageFiles);
    return out;
  }
  const facts = readPage(page.text);

  const robotsMeta = `${facts.meta.get("robots") ?? ""} ${page.xRobotsTag ?? ""}`;
  if (/noindex/i.test(robotsMeta)) add("noindex", "error", "Marked noindex, so search and AI engines are told to drop it.", metaFiles);

  if (!facts.title) add("title-missing", "error", "No <title>.", metaFiles);
  else if (facts.title.length > 65) add("title-long", "info", `Title is ${facts.title.length} characters; results truncate around 60.`, metaFiles);

  const description = facts.meta.get("description");
  if (!description) add("description-missing", "warn", "No meta description. Engines fall back to whatever text they find.", metaFiles);
  else if (description.length < 50 || description.length > 160) {
    add("description-length", "info", `Meta description is ${description.length} characters; aim for 50–160.`, metaFiles);
  }

  if (!facts.canonical) add("canonical-missing", "info", "No canonical URL.", metaFiles);
  if (!facts.meta.get("og:title") || !facts.meta.get("og:image")) add("og-missing", "info", "Missing og:title or og:image, used for link previews.", metaFiles);

  if (facts.h1Count === 0) add("h1-missing", "warn", "No <h1> in the served HTML.", pageFiles);
  else if (facts.h1Count > 1) add("h1-multiple", "info", `${facts.h1Count} <h1> elements.`, pageFiles);

  for (const ld of facts.jsonLd) if (!ld.ok) add("jsonld-invalid", "error", `A JSON-LD block doesn't parse: ${ld.error}`, pageFiles);
  const types = facts.jsonLd.flatMap((ld) => (ld.ok ? ld.types : []));
  if (facts.jsonLd.length === 0) {
    add("jsonld-missing", "warn", `No JSON-LD structured data.${isHome ? " Add Organization or WebSite on the home page." : ""}`, isHome && metaFiles.length ? metaFiles : pageFiles);
  } else if (isHome && !types.some((t) => /^(Organization|Corporation|WebSite|SoftwareApplication|LocalBusiness)$/.test(t))) {
    add("jsonld-no-entity", "info", `Home page JSON-LD (${types.join(", ") || "untyped"}) doesn't describe the organization or site.`, metaFiles);
  }

  // Most AI crawlers don't run JavaScript, so a client-rendered page reads as empty.
  if (facts.visibleTextLength < 250) {
    add("thin-html", "warn", `Only ${facts.visibleTextLength} characters of text in the served HTML. If content renders client-side, AI crawlers won't see it.`, pageFiles);
  }
  return out;
}
