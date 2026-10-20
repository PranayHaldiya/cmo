# cmo

**Dependabot for AI search.** A weekly GitHub Action that opens PRs to get your site cited by ChatGPT, Perplexity and Claude, and proves which merged PRs moved citations and clicks.

Bring your own API keys. Runs in your repo. No credits, no dashboard to log into.

> Status: early. Citation checks, the URL-to-source mapper and the attribution ledger work; fix PRs and the Action are next. See [PLAN.md](PLAN.md).

## Why

AI-visibility tools can tell you that ChatGPT doesn't cite you. They don't fix it in your codebase, and they can't tell you whether the fix worked.

`cmo` does both:

1. **Track** citations across AI engines for a fixed prompt set, stored in a local SQLite ledger.
2. **Fix**: map each finding to the exact file in your repo that renders the page (Next.js App/Pages Router, Astro, MD/MDX content), then open a PR.
3. **Prove**: after a PR merges, compare citation rate and Search Console clicks before and after.

## Check who AI engines cite

Write a `cmo.config.json` (see [cmo.config.example.json](cmo.config.example.json)) with your brand, competitors, and the questions buyers ask. Then:

```sh
AI_GATEWAY_API_KEY=... node src/cli.ts cite
```

One [Vercel AI Gateway](https://vercel.com/ai-gateway) key covers every engine: OpenAI, Anthropic and Gemini (each with web search on), and Perplexity Sonar. Without it, `cmo` uses `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` directly and skips engines it has no key for.

```
[1/3] ✓ anthropic/claude-haiku-5.5  Which AI agent can automate SEO, Reddit and X marketing for a startup?
[2/3] ✓ anthropic/claude-haiku-5.5  What is the best AI CMO tool for a solo SaaS founder?
[3/3] · anthropic/claude-haiku-5.5  Recommend AI marketing automation tools for small B2B SaaS teams in 2026.

  anthropic/claude-haiku-5.5
    Okara                    cited 2/3   named 2/3
    Jasper                   cited 0/3   named 2/3
    Copy.ai                  cited 0/3   named 0/3
```

"Cited" means one of your URLs was among the answer's sources; "named" means the brand appeared in the answer at all. Every answer, its sources and cost go into `.cmo/ledger.db`. If web search fails, the check is marked failed rather than recorded as an answer written from memory.

## Try the mapper

```sh
node src/cli.ts routes -r path/to/your/site
node src/cli.ts locate -r path/to/your/site https://yoursite.com/blog/some-post /pricing
```

```json
{
  "url": "/blog/hello-world",
  "page": "app/blog/[slug]/page.tsx",
  "params": { "slug": "hello-world" },
  "metadataOwner": "app/blog/[slug]/page.tsx",
  "content": "content/blog/hello-world.mdx"
}
```

Requires Node 24+ (runs TypeScript directly, uses built-in `node:sqlite`).

## License

MIT
