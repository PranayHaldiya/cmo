// Turns a site's source tree into a route table, so a live URL can be traced
// back to the file that renders it (and, for dynamic routes, the content file).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type Framework = "next-app" | "next-pages" | "astro";

export type Segment =
  | { type: "static"; value: string }
  | { type: "dynamic"; name: string }
  | { type: "catchall"; name: string; optional: boolean };

export interface Route {
  framework: Framework;
  /** Path to the page file, relative to the site root. */
  file: string;
  segments: Segment[];
}

export interface Match {
  route: Route;
  params: Record<string, string | string[]>;
}

const PAGE_EXT = /\.(tsx|ts|jsx|js|mdx|md)$/;
const ASTRO_EXT = /\.(astro|md|mdx|html)$/;

export function detectFrameworks(root: string): Framework[] {
  const found: Framework[] = [];
  if (firstDir(root, ["app", "src/app"])) found.push("next-app");
  if (firstDir(root, ["pages", "src/pages"]) && hasDep(root, "next")) found.push("next-pages");
  if (existsSync(join(root, "src/pages")) && hasDep(root, "astro")) found.push("astro");
  return found;
}

export function buildRoutes(root: string): Route[] {
  const routes: Route[] = [];
  for (const framework of detectFrameworks(root)) {
    if (framework === "next-app") routes.push(...nextAppRoutes(root));
    if (framework === "next-pages") routes.push(...nextPagesRoutes(root));
    if (framework === "astro") routes.push(...astroRoutes(root));
  }
  return routes.sort(compareSpecificity);
}

export function matchUrl(routes: Route[], url: string): Match | null {
  const parts = urlParts(url);
  for (const route of routes) {
    const params = matchSegments(route.segments, parts);
    if (params) return { route, params };
  }
  return null;
}

function nextAppRoutes(root: string): Route[] {
  const appDir = firstDir(root, ["app", "src/app"])!;
  const routes: Route[] = [];
  for (const file of walk(appDir)) {
    const name = file.split(sep).pop()!;
    if (!/^page\./.test(name) || !PAGE_EXT.test(name)) continue;
    const dirs = relative(appDir, file).split(sep).slice(0, -1);
    // Private folders, parallel-route slots and intercepting routes never own a URL.
    if (dirs.some((d) => d.startsWith("_") || d.startsWith("@") || /^\(\.+\)/.test(d))) continue;
    const segments = dirs.filter((d) => !/^\(.*\)$/.test(d)).map(parseBracketSegment);
    routes.push({ framework: "next-app", file: relative(root, file), segments });
  }
  return routes;
}

function nextPagesRoutes(root: string): Route[] {
  const pagesDir = firstDir(root, ["pages", "src/pages"])!;
  const routes: Route[] = [];
  for (const file of walk(pagesDir)) {
    const rel = relative(pagesDir, file);
    if (!PAGE_EXT.test(rel) || rel.startsWith(`api${sep}`)) continue;
    if (/^_(app|document|error)\./.test(rel) || /^(404|500)\./.test(rel)) continue;
    routes.push({ framework: "next-pages", file: relative(root, file), segments: fileSegments(rel, PAGE_EXT) });
  }
  return routes;
}

function astroRoutes(root: string): Route[] {
  const pagesDir = join(root, "src/pages");
  const routes: Route[] = [];
  for (const file of walk(pagesDir)) {
    const rel = relative(pagesDir, file);
    if (!ASTRO_EXT.test(rel) || rel.split(sep).some((p) => p.startsWith("_"))) continue;
    // Astro rest params also match zero segments: [...page].astro serves /themes/author/x.
    const segments = fileSegments(rel, ASTRO_EXT).map((s) => (s.type === "catchall" ? { ...s, optional: true } : s));
    routes.push({ framework: "astro", file: relative(root, file), segments });
  }
  return routes;
}

/** File-based routers: `blog/[slug].tsx` and `blog/index.tsx` style paths. */
function fileSegments(rel: string, ext: RegExp): Segment[] {
  const parts = rel.replace(ext, "").split(sep);
  if (parts.at(-1) === "index") parts.pop();
  return parts.map(parseBracketSegment);
}

function parseBracketSegment(part: string): Segment {
  let m = part.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (m) return { type: "catchall", name: m[1]!, optional: true };
  m = part.match(/^\[\.\.\.(.+)\]$/);
  if (m) return { type: "catchall", name: m[1]!, optional: false };
  m = part.match(/^\[(.+)\]$/);
  if (m) return { type: "dynamic", name: m[1]! };
  return { type: "static", value: part };
}

function matchSegments(segments: Segment[], parts: string[]): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.type === "catchall") {
      const rest = parts.slice(i);
      if (rest.length === 0 && !seg.optional) return null;
      if (rest.length > 0) params[seg.name] = rest;
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (seg.type === "static" && seg.value !== part) return null;
    if (seg.type === "dynamic") params[seg.name] = part;
  }
  return parts.length === segments.length ? params : null;
}

/** Static beats dynamic beats catch-all beats optional catch-all, segment by segment. */
function compareSpecificity(a: Route, b: Route): number {
  const rank = (s: Segment | undefined) =>
    s === undefined ? -1 : s.type === "static" ? 0 : s.type === "dynamic" ? 1 : s.optional ? 3 : 2;
  for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
    const d = rank(a.segments[i]) - rank(b.segments[i]);
    if (d !== 0) return d;
  }
  return a.file.localeCompare(b.file);
}

function urlParts(url: string): string[] {
  const path = /^https?:\/\//.test(url) ? new URL(url).pathname : url.split(/[?#]/)[0]!;
  return path.split("/").filter(Boolean).map(decodeURIComponent);
}

function firstDir(root: string, candidates: string[]): string | undefined {
  return candidates.map((c) => join(root, c)).find((p) => existsSync(p) && statSync(p).isDirectory());
}

function hasDep(root: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

export function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
