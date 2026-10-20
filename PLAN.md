# Plan

Positioning: the open, repo-native loop of **track → fix PR → prove**. Not another audit tool or GEO dashboard.

## Landscape (2026-10-20)
- Auriti-Labs/geo-optimizer-skill (Python, 1.1k★): audit, citations, MCP and Action. Writes fix files locally but opens no PRs, has no URL→source mapping and no Search Console data. **Closest; could add PRs.**
- elmohq/elmo, limelit-co/open, GEORank: citation tracking dashboards.
- houtini-ai/seo-audit: audit ranked by Search Console data, but only produces fix snippets.
- Closed SaaS doing PR fixes: SEOmatic, OptiAISEO, SEODevil, CrawlX, Conservatory.
- Takeaway: don't rebuild the audit. The moat is URL→file mapping and the attribution ledger.

## Milestones
- [x] M0 URL → page / metadata owner / content file (Next app + pages, Astro), tested on astro.build, vercel/commerce, leerob/site
- [x] M0 ledger schema + before/after fix impact
- [x] M1 `cmo cite`: prompt set × engines with web search (AI Gateway or direct keys), cited vs named detection, competitors, ledger. Verified live on Anthropic.
- [ ] M1 verify OpenAI, Gemini and Perplexity engines live (needs a gateway key)
- [ ] M1 repeat runs per prompt (answers vary between runs) and report rates with sample size
- [ ] M1 `cmo audit`: a small set of AI-readiness checks (llms.txt, robots AI crawlers, JSON-LD, meta), each tied to a located file
- [ ] M2 `cmo fix`: deterministic fixes (llms.txt, robots, JSON-LD, metadata) applied as edits, then `gh pr create`
- [ ] M2 Search Console import (daily per-page clicks) into the ledger
- [ ] M3 GitHub Action (weekly): cite → audit → open PRs → comment impact on merged PRs
- [ ] M3 MCP server exposing locate, audit, cite and impact
- [ ] Later: hand-off to Claude Code / Codex for non-deterministic fixes (copy, FAQ sections)

## Open questions
- Ledger storage in the Action: commit the SQLite file to a `cmo-data` branch, or use Actions cache/artifacts?
- Which engines does v1 query: OpenAI (web search), Perplexity Sonar, Anthropic (web search), Gemini (grounding)? Cost per weekly run with ~20 prompts × 4 engines.
