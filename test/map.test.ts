import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SiteMap } from "../src/map/locate.ts";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

describe("next app router", () => {
  const site = new SiteMap(fixture("next-app"));

  it("maps the home page and inherits metadata from the root layout", () => {
    const loc = site.locate("https://example.com/")!;
    assert.equal(loc.page, "app/page.tsx");
    assert.equal(loc.metadataOwner, "app/layout.tsx");
  });

  it("strips route groups and keeps page-level metadata", () => {
    const loc = site.locate("/pricing")!;
    assert.equal(loc.page, "app/(marketing)/pricing/page.tsx");
    assert.equal(loc.metadataOwner, "app/(marketing)/pricing/page.tsx");
  });

  it("prefers a static segment over a dynamic one", () => {
    assert.equal(site.locate("/blog/featured")!.page, "app/blog/featured/page.tsx");
  });

  it("resolves a dynamic route to its content file", () => {
    const loc = site.locate("/blog/hello-world?utm_source=x")!;
    assert.equal(loc.page, "app/blog/[slug]/page.tsx");
    assert.deepEqual(loc.params, { slug: "hello-world" });
    assert.equal(loc.content, "content/blog/hello-world.mdx");
    assert.equal(loc.metadataOwner, "app/blog/[slug]/page.tsx");
  });

  it("finds index.md content for a slug", () => {
    assert.equal(site.locate("/blog/nested")!.content, "content/blog/nested/index.md");
  });

  it("matches optional catch-all with and without segments", () => {
    assert.equal(site.locate("/docs")!.page, "app/docs/[[...slug]]/page.mdx");
    assert.deepEqual(site.locate("/docs/a/b")!.params, { slug: ["a", "b"] });
  });

  it("ignores private folders, parallel slots and intercepting routes", () => {
    assert.equal(site.locate("/_components"), null);
    assert.equal(site.locate("/login"), null);
    assert.equal(site.locate("/photo"), null);
  });

  it("finds site-level AI and crawler files", () => {
    assert.deepEqual(site.siteFiles(), { robots: "app/robots.ts", llmsTxt: "public/llms.txt" });
  });
});

describe("astro", () => {
  const site = new SiteMap(fixture("astro"));

  it("maps index, markdown pages and nested index files", () => {
    assert.equal(site.locate("/")!.page, "src/pages/index.astro");
    assert.equal(site.locate("/about")!.page, "src/pages/about.md");
    assert.equal(site.locate("/blog")!.page, "src/pages/blog/index.astro");
  });

  it("resolves a dynamic route to a content collection entry", () => {
    const loc = site.locate("/blog/first-post")!;
    assert.equal(loc.page, "src/pages/blog/[slug].astro");
    assert.equal(loc.content, "src/content/blog/first-post.md");
  });

  it("falls back to the rest route and skips underscore files", () => {
    assert.equal(site.locate("/anything/else")!.page, "src/pages/[...path].astro");
    assert.equal(site.locate("/_drafts/wip")!.page, "src/pages/[...path].astro");
  });
});

describe("astro rest params", () => {
  it("match zero segments, like Astro does", () => {
    const site = new SiteMap(fixture("astro"));
    assert.equal(site.locate("/")!.page, "src/pages/index.astro", "a static index still wins");
    assert.equal(site.locate("/authors/ada")!.page, "src/pages/authors/[id]/[...page].astro");
    assert.deepEqual(site.locate("/authors/ada/2")!.params, { id: "ada", page: ["2"] });
  });
});
