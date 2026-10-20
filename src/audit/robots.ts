// robots.txt matching per RFC 9309: the most specific user-agent group
// applies, and within it the longest matching rule wins (Allow on ties).

interface Group {
  agents: string[];
  rules: Array<{ allow: boolean; pattern: string }>;
}

/** Crawlers that fetch pages to answer a user's question; blocking them stops citations. */
export const AI_SEARCH_BOTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
/** Crawlers that collect training data; blocking them is a legitimate choice. */
export const AI_TRAINING_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot"];

export function parseRobots(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [key, value] = [m[1]!.toLowerCase(), m[2]!.trim()];
    if (key === "sitemap") {
      sitemaps.push(value);
    } else if (key === "user-agent") {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if ((key === "allow" || key === "disallow") && current) {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    }
    lastWasAgent = false;
  }
  return { groups, sitemaps };
}

export function isAllowed(robots: ReturnType<typeof parseRobots>, userAgent: string, path = "/"): boolean {
  const ua = userAgent.toLowerCase();
  const named = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const groups = named.length > 0 ? named : robots.groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | undefined;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best?.allow ?? true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
