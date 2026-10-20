import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { audit, type Snapshot } from "../src/audit/checks.ts";
import { readPage } from "../src/audit/html.ts";
import { isAllowed, parseRobots } from "../src/audit/robots.ts";
import { SiteMap } from "../src/map/locate.ts";

describe("robots.txt", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: PerplexityBot
Disallow:

Sitemap: https://example.com/sitemap.xml
`);

  it("applies the most specific group", () => {
    assert.equal(isAllowed(robots, "GPTBot"), false);
    assert.equal(isAllowed(robots, "CCBot/2.0"), false);
    assert.equal(isAllowed(robots, "OAI-SearchBot"), true);
  });

  it("uses the longest matching rule and lets Allow win", () => {
    assert.equal(isAllowed(robots, "Claude-SearchBot", "/admin/x"), false);
    assert.equal(isAllowed(robots, "Claude-SearchBot", "/admin/public/x"), true);
  });

  it("treats an empty Disallow as allow-all", () => {
    assert.equal(isAllowed(robots, "PerplexityBot", "/admin"), true);
  });

  it("supports wildcards and end anchors", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    assert.equal(isAllowed(r, "x", "/a/b.pdf"), false);
    assert.equal(isAllowed(r, "x", "/a/b.pdf?x=1"), true);
  });

  it("collects sitemaps", () => {
    assert.deepEqual(robots.sitemaps, ["https://example.com/sitemap.xml"]);
  });
});

describe("readPage", () => {
  it("reads head tags, JSON-LD types and visible text", () => {
    const facts = readPage(`<html><head>
      <title>Acme &amp; Co</title>
      <meta name="description" content="Deploys in seconds">
      <meta property="og:title" content='Acme'>
      <link rel="canonical" href="https://acme.dev/">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite"]}]}</script>
      <script type="application/ld+json">{broken</script>
      <script>var hidden = "not visible text";</script>
    </head><body><h1>Hi</h1><p>Hello world</p></body></html>`);
    assert.equal(facts.title, "Acme & Co");
    assert.equal(facts.meta.get("description"), "Deploys in seconds");
    assert.equal(facts.meta.get("og:title"), "Acme");
    assert.equal(facts.canonical, "https://acme.dev/");
    assert.deepEqual(facts.jsonLd[0], { ok: true, types: ["Organization", "WebSite"] });
    assert.equal(facts.jsonLd[1]!.ok, false);
    assert.equal(facts.h1Count, 1);
    assert.equal(facts.visibleTextLength, "Acme & Co Hi Hello world".length);
  });
});

describe("audit", () => {
  const goodPage = (title: string) =>
    `<html><head><title>${title}</title><meta name="description" content="${"A clear description of this page. ".repeat(3)}">
     <meta property="og:title" content="x"><meta property="og:image" content="x.png"><link rel="canonical" href="/">
     <script type="application/ld+json">{"@type":"Organization"}</script></head>
     <body><h1>${title}</h1><p>${"Real server-rendered content. ".repeat(20)}</p></body></html>`;

  const base: Snapshot = {
    origin: "https://acme.dev",
    robots: { status: 200, text: "User-agent: *\nAllow: /" },
    llmsTxt: { status: 200, text: "# Acme", contentType: "text/plain" },
    sitemapUrls: ["https://acme.dev/"],
    pages: [{ url: "https://acme.dev/", status: 200, text: goodPage("Acme") }],
  };

  it("finds nothing on a well-formed site", () => {
    assert.deepEqual(audit(base), []);
  });

  it("flags blocked AI search crawlers as errors and training blocks as notes", () => {
    const findings = audit({ ...base, robots: { status: 200, text: "User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /" } });
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    assert.equal(byId["robots-blocks-ai-search"]!.severity, "error");
    assert.match(byId["robots-blocks-ai-search"]!.message, /OAI-SearchBot/);
    assert.equal(byId["robots-blocks-ai-training"]!.severity, "info");
  });

  it("treats an HTML llms.txt (a catch-all route) as missing", () => {
    const ids = audit({ ...base, llmsTxt: { status: 200, text: "<!doctype html>", contentType: "text/html" } }).map((f) => f.id);
    assert.ok(ids.includes("llms-txt-missing"));
  });

  it("flags a client-rendered page with no head metadata", () => {
    const ids = audit({ ...base, pages: [{ url: "https://acme.dev/", status: 200, text: '<html><body><div id="root"></div></body></html>' }] }).map((f) => f.id);
    assert.deepEqual(ids.sort(), ["canonical-missing", "description-missing", "h1-missing", "jsonld-missing", "og-missing", "thin-html", "title-missing"]);
  });

  it("names the files each fix touches when the repo is available", () => {
    const site = new SiteMap(join(import.meta.dirname, "fixtures", "next-app"));
    const findings = audit(
      {
        ...base,
        llmsTxt: { status: 404, text: "" },
        pages: [{ url: "https://acme.dev/blog/hello-world", status: 200, text: "<html><head><title>Hello</title></head><body></body></html>" }],
      },
      site,
    );
    const files = (id: string) => findings.find((f) => f.id === id)?.files;
    assert.deepEqual(files("llms-txt-missing"), ["public/llms.txt"]);
    assert.deepEqual(files("description-missing"), ["app/blog/[slug]/page.tsx"]);
    assert.deepEqual(files("h1-missing"), ["app/blog/[slug]/page.tsx", "content/blog/hello-world.mdx"]);
  });
});
