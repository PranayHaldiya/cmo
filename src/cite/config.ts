import { readFileSync } from "node:fs";
import type { Brand } from "./detect.ts";

export interface CmoConfig {
  brand: Brand;
  competitors: Brand[];
  /** Questions a buyer might ask an AI assistant, phrased without naming the brand. */
  prompts: string[];
  /** AI Gateway model ids; web search is switched on per provider. */
  engines: string[];
  /** Times to ask each engine each prompt; answers vary between runs. */
  runs: number;
}

export const DEFAULT_ENGINES = [
  "openai/gpt-5.4-mini",
  "anthropic/claude-haiku-5.5",
  "google/gemini-3.8-flash",
  "perplexity/sonar",
];

export function loadConfig(path: string): CmoConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw.brand?.name || !Array.isArray(raw.brand?.domains) || raw.brand.domains.length === 0) {
    throw new Error(`${path}: "brand" needs a "name" and at least one entry in "domains"`);
  }
  if (!Array.isArray(raw.prompts) || raw.prompts.length === 0) {
    throw new Error(`${path}: "prompts" needs at least one question`);
  }
  return {
    brand: raw.brand,
    competitors: raw.competitors ?? [],
    prompts: raw.prompts,
    engines: raw.engines ?? DEFAULT_ENGINES,
    runs: raw.runs ?? 1,
  };
}
