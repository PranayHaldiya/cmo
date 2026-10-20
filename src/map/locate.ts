// Answers "which files would a fix for this URL touch?": the page, the file
// that owns its <head> metadata, and the content file behind a dynamic route.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { buildRoutes, matchUrl, walk, type Match, type Route } from "./routes.ts";

export interface Location {
  url: string;
  page: string;
  framework: Route["framework"];
  params: Match["params"];
  /** File exporting `metadata`/`generateMetadata` (Next app router), else the page. */
  metadataOwner: string;
  /** Markdown/MDX file named after the dynamic param, if one exists. */
  content?: string;
}

export interface SiteFiles {
  robots?: string;
  sitemap?: string;
  llmsTxt?: string;
}

const CONTENT_DIRS = ["content", "src/content", "posts", "_posts", "data", "docs"];
const METADATA_EXPORT = /export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b|const\s+generateMetadata\b)/;

export class SiteMap {
  readonly root: string;
  readonly routes: Route[];
  private contentIndex?: Map<string, string[]>;

  constructor(root: string) {
    this.root = root;
    this.routes = buildRoutes(root);
  }

  locate(url: string): Location | null {
    const match = matchUrl(this.routes, url);
    if (!match) return null;
    const { route, params } = match;
    const content = this.findContent(params);
    return {
      url,
      page: route.file,
      framework: route.framework,
      params,
      metadataOwner: route.framework === "next-app" ? this.metadataOwner(route.file) : route.file,
      ...(content && { content }),
    };
  }

  siteFiles(): SiteFiles {
    const first = (candidates: string[]) => candidates.find((c) => existsSync(join(this.root, c)));
    const appDirs = ["app", "src/app"];
    return pruneUndefined({
      robots: first([...appDirs.flatMap((d) => [`${d}/robots.ts`, `${d}/robots.js`, `${d}/robots.txt`]), "public/robots.txt"]),
      sitemap: first([...appDirs.flatMap((d) => [`${d}/sitemap.ts`, `${d}/sitemap.js`, `${d}/sitemap.xml`]), "public/sitemap.xml"]),
      llmsTxt: first([...appDirs.flatMap((d) => [`${d}/llms.txt/route.ts`, `${d}/llms.txt/route.js`]), "public/llms.txt", "src/pages/llms.txt.ts"]),
    });
  }

  /** Walk from the page up through its layouts; the closest metadata export wins. */
  private metadataOwner(pageFile: string): string {
    const appRoot = pageFile.startsWith(`src${sep}`) ? join("src", "app") : "app";
    if (this.exportsMetadata(pageFile)) return pageFile;
    for (let dir = dirname(pageFile); ; dir = dirname(dir)) {
      const layout = layoutNames(extname(pageFile)).map((n) => join(dir, n)).find((f) => this.exportsMetadata(f));
      if (layout) return layout;
      if (dir === appRoot || dir === "." || dir === dirname(dir)) return pageFile;
    }
  }

  private exportsMetadata(file: string): boolean {
    const full = join(this.root, file);
    return existsSync(full) && METADATA_EXPORT.test(readFileSync(full, "utf8"));
  }

  private findContent(params: Match["params"]): string | undefined {
    const values = Object.values(params);
    if (values.length === 0) return undefined;
    const last = values.at(-1)!;
    const slug = Array.isArray(last) ? last.join("/") : last;
    const index = this.buildContentIndex();
    const hits = index.get(slug) ?? index.get(slug.split("/").at(-1)!) ?? [];
    // Prefer a hit whose directory path also matches a nested slug like "guides/setup".
    return hits.find((h) => h.replace(/\.(md|mdx)$/, "").replace(/\/index$/, "").endsWith(slug)) ?? hits[0];
  }

  private buildContentIndex(): Map<string, string[]> {
    if (this.contentIndex) return this.contentIndex;
    const index = new Map<string, string[]>();
    for (const dir of CONTENT_DIRS.map((d) => join(this.root, d)).filter(existsSync)) {
      for (const file of walk(dir)) {
        if (!/\.(md|mdx)$/.test(file)) continue;
        const rel = relative(this.root, file);
        const stem = basename(file).replace(/\.(md|mdx)$/, "");
        const key = stem === "index" ? basename(dirname(file)) : stem;
        index.set(key, [...(index.get(key) ?? []), rel]);
      }
    }
    return (this.contentIndex = index);
  }
}

function layoutNames(pageExt: string): string[] {
  return [...new Set([`layout${pageExt}`, "layout.tsx", "layout.ts", "layout.jsx", "layout.js"])];
}

function pruneUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
