// Decides whether an AI answer cited or mentioned a brand. "Cited" means one
// of the brand's URLs appears among the answer's sources or in its text;
// "mentioned" means the brand is named without a link.

export interface Brand {
  name: string;
  domains: string[];
  /** Other names the brand goes by, e.g. product names. */
  aliases?: string[];
}

export interface Visibility {
  cited: boolean;
  mentioned: boolean;
  citedUrls: string[];
}

export interface Detection extends Visibility {
  competitors: Array<{ name: string } & Visibility>;
}

export function detect(text: string, sourceUrls: string[], brand: Brand, competitors: Brand[] = []): Detection {
  const urls = [...new Set([...sourceUrls, ...urlsInText(text)])];
  return {
    ...visibility(text, urls, brand),
    competitors: competitors.map((c) => ({ name: c.name, ...visibility(text, urls, c) })),
  };
}

function visibility(text: string, urls: string[], brand: Brand): Visibility {
  const citedUrls = urls.filter((u) => brand.domains.some((d) => hostMatches(u, d)));
  const names = [brand.name, ...(brand.aliases ?? []), ...brand.domains];
  const mentioned = names.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, "iu").test(text));
  return { cited: citedUrls.length > 0, mentioned, citedUrls };
}

function hostMatches(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const d = domain.toLowerCase().replace(/^www\./, "");
    return host === d || host.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

function urlsInText(text: string): string[] {
  return text.match(/https?:\/\/[^\s)\]>"'`]+/g)?.map((u) => u.replace(/[.,;:]+$/, "")) ?? [];
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
