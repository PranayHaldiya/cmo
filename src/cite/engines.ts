// Asks one engine one question with web search on, the way a user of that
// assistant would, and returns the answer plus the URLs it drew on.

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, isStepCount, type LanguageModel, type ToolSet } from "ai";

export interface Answer {
  text: string;
  sources: string[];
  costUsd?: number;
}

function searchTools(engine: string): ToolSet {
  const provider = engine.split("/")[0];
  if (provider === "openai") return { web_search: openai.tools.webSearch({}) };
  // The 20260209 version filters results with code execution, and smaller models often
  // send it malformed input; the plain version is reliable.
  if (provider === "anthropic") return { web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }) };
  if (provider === "google") return { google_search: google.tools.googleSearch({}) };
  // Perplexity's Sonar models search on every request and return sources natively.
  return {};
}

const DIRECT_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** One AI Gateway key covers every engine; without it, fall back to each provider's own key. */
export function hasCredentials(engine: string): boolean {
  const key = DIRECT_KEYS[engine.split("/")[0]!];
  return Boolean(process.env.AI_GATEWAY_API_KEY || (key && process.env[key]));
}

function resolveModel(engine: string): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) return engine;
  const [provider, id] = engine.split("/") as [string, string];
  if (!hasCredentials(engine)) {
    throw new Error(`no credentials: set AI_GATEWAY_API_KEY${DIRECT_KEYS[provider] ? ` or ${DIRECT_KEYS[provider]}` : ""}`);
  }
  if (provider === "openai") return openai(id);
  // Gateway ids use dots in versions (claude-haiku-5.5); the Anthropic API uses dashes.
  if (provider === "anthropic") return anthropic(id.replaceAll(".", "-"));
  return google(id);
}

export async function ask(engine: string, prompt: string): Promise<Answer> {
  const result = await generateText({
    model: resolveModel(engine),
    prompt,
    tools: searchTools(engine),
    stopWhen: isStepCount(5),
  });
  const sources = result.sources.flatMap((s) => (s.sourceType === "url" ? [s.url] : []));
  // An answer written from memory because search broke would skew the ledger, so fail instead.
  const searchErrors = result.steps.flatMap((s) => s.content).filter((c) => c.type === "tool-error");
  if (sources.length === 0 && searchErrors.length > 0) {
    throw new Error(`web search failed: ${searchErrors.map((e) => JSON.stringify(e.error)).join("; ").slice(0, 200)}`);
  }
  const cost = Number(result.providerMetadata?.gateway?.cost);
  return { text: result.text, sources, ...(Number.isFinite(cost) && { costUsd: cost }) };
}
