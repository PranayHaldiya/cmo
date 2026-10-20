# cmo

**Dependabot for AI search.** A weekly GitHub Action that opens PRs to get your site cited by ChatGPT, Perplexity and Claude, and proves which merged PRs moved citations and clicks.

Bring your own API keys. Runs in your repo. No credits, no dashboard to log into.

> Status: early. The URL-to-source mapper and the attribution ledger work; citation checks, fix PRs and the Action are next. See [PLAN.md](PLAN.md).

## Why

AI-visibility tools can tell you that ChatGPT doesn't cite you. They don't fix it in your codebase, and they can't tell you whether the fix worked.

`cmo` does both:

1. **Track** citations across AI engines for a fixed prompt set, stored in a local SQLite ledger.
2. **Fix**: map each finding to the exact file in your repo that renders the page (Next.js App/Pages Router, Astro, MD/MDX content), then open a PR.
3. **Prove**: after a PR merges, compare citation rate and Search Console clicks before and after.

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
