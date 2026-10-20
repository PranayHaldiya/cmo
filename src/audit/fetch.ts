// Fetches what an AI crawler would: robots.txt, llms.txt, the sitemap and a
// sample of pages, as served HTML.

import type { Fetched, Snapshot } from "./checks.ts";
import { parseRobots } from "./robots.ts";

const USER_AGENT = "cmo-audit/0.1 (+https://github.com/PranayHaldiya/cmo)";

export async function snapshot(siteUrl: string, opts: { urls?: string[]; limit?: number } = {}): Promise<Snapshot> {
  const origin = new URL(siteUrl).origin;
  const [robots, llmsTxt] = await Promise.all([get(`${origin}/robots.txt`), get(`${origin}/llms.txt`)]);
  const declared = robots && robots.status < 400 ? parseRobots(robots.text).sitemaps : [];
  const sitemapUrls = await readSitemaps(declared.length ? declared : [`${origin}/sitemap.xml`]);

  const wanted = opts.urls?.length
    ? opts.urls.map((u) => new URL(u, origin).href)
    : [`${origin}/`, ...(sitemapUrls ?? []).filter((u) => sameSite(u, origin) && new URL(u).pathname !== "/")].slice(0, opts.limit ?? 20);
  const pages = await Promise.all(wanted.map(async (url) => ({ url, ...((await get(url)) ?? { status: 0, text: "" }) })));

  return {
    origin,
    ...(robots && { robots }),
    ...(llmsTxt && { llmsTxt }),
    ...(sitemapUrls && { sitemapUrls }),
    pages,
  };
}

/** Follows one level of sitemap index; returns undefined when no sitemap exists. */
async function readSitemaps(locations: string[]): Promise<string[] | undefined> {
  const urls: string[] = [];
  let found = false;
  for (const location of locations) {
    const res = await get(location);
    if (!res || res.status >= 400 || !/<(urlset|sitemapindex)/i.test(res.text)) continue;
    found = true;
    const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
    if (/<sitemapindex/i.test(res.text)) {
      for (const child of locs.slice(0, 5)) {
        const sub = await get(child);
        if (sub && sub.status < 400) urls.push(...[...sub.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!));
      }
    } else {
      urls.push(...locs);
    }
  }
  return found ? [...new Set(urls)] : undefined;
}

function sameSite(url: string, origin: string): boolean {
  try {
    const bare = (h: string) => h.replace(/^www\./, "");
    return bare(new URL(url).hostname) === bare(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function get(url: string): Promise<Fetched | undefined> {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const contentType = res.headers.get("content-type");
    const xRobotsTag = res.headers.get("x-robots-tag");
    return {
      status: res.status,
      text: await res.text(),
      ...(contentType && { contentType }),
      ...(xRobotsTag && { xRobotsTag }),
    };
  } catch {
    return undefined;
  }
}
