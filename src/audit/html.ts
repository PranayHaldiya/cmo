// Just enough HTML reading for an audit: head tags, JSON-LD and visible text.
// Pages are only read, never executed, so what we see is what a crawler that
// doesn't run JavaScript sees.

export interface PageFacts {
  title?: string;
  meta: Map<string, string>;
  canonical?: string;
  jsonLd: Array<{ ok: true; types: string[] } | { ok: false; error: string }>;
  h1Count: number;
  visibleTextLength: number;
}

export function readPage(html: string): PageFacts {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.name ?? a.property)?.toLowerCase();
    if (key && a.content !== undefined) meta.set(key, a.content.trim());
  }
  const canonicalTag = (html.match(/<link\s[^>]*>/gi) ?? []).map(attrs).find((a) => a.rel?.toLowerCase().split(/\s+/).includes("canonical"));
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    ...(title !== undefined && { title: decode(title).trim() }),
    meta,
    ...(canonicalTag?.href && { canonical: canonicalTag.href }),
    jsonLd: [...html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => parseJsonLd(m[1]!)),
    h1Count: html.match(/<h1[\s>]/gi)?.length ?? 0,
    visibleTextLength: visibleText(html).length,
  };
}

function parseJsonLd(body: string): PageFacts["jsonLd"][number] {
  try {
    const data = JSON.parse(body);
    const types = new Set<string>();
    const collect = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (!node || typeof node !== "object") return;
      const t = (node as Record<string, unknown>)["@type"];
      for (const v of Array.isArray(t) ? t : [t]) if (typeof v === "string") types.add(v);
      collect((node as Record<string, unknown>)["@graph"]);
    };
    collect(data);
    return { ok: true, types: [...types] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
