import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CmoConfig } from "../src/cite/config.ts";
import { detect } from "../src/cite/detect.ts";
import { runCitations } from "../src/cite/run.ts";
import { Ledger } from "../src/ledger/db.ts";

const brand = { name: "Acme", domains: ["acme.dev"], aliases: ["Acme CLI"] };
const rival = { name: "Globex", domains: ["globex.com"] };

describe("detect", () => {
  it("counts a source on a subdomain as a citation", () => {
    const d = detect("Try these tools.", ["https://docs.acme.dev/start", "https://other.io"], brand);
    assert.equal(d.cited, true);
    assert.deepEqual(d.citedUrls, ["https://docs.acme.dev/start"]);
  });

  it("counts a link written in the answer text as a citation", () => {
    assert.equal(detect("See https://www.acme.dev/pricing.", [], brand).cited, true);
  });

  it("treats a bare name as a mention, not a citation", () => {
    const d = detect("Most teams use acme for this.", [], brand);
    assert.equal(d.cited, false);
    assert.equal(d.mentioned, true);
  });

  it("does not match the name inside another word", () => {
    assert.equal(detect("Acmetric and Pacmesh are popular.", [], brand).mentioned, false);
  });

  it("does not count lookalike domains", () => {
    assert.equal(detect("", ["https://notacme.dev", "https://acme.dev.evil.io"], brand).cited, false);
  });

  it("reports competitors separately", () => {
    const d = detect("Globex is the default choice.", ["https://globex.com/x"], brand, [rival]);
    assert.equal(d.cited, false);
    assert.deepEqual(d.competitors, [{ name: "Globex", cited: true, mentioned: true, citedUrls: ["https://globex.com/x"] }]);
  });
});

describe("runCitations", () => {
  const config: CmoConfig = {
    brand,
    competitors: [rival],
    prompts: ["best deploy cli?", "how to ship fast?"],
    engines: ["fake/a", "fake/b"],
  };

  it("records every answer and survives a failing engine", async () => {
    const ledger = new Ledger(":memory:");
    const ask = async (engine: string, prompt: string) => {
      if (engine === "fake/b" && prompt.startsWith("how")) throw new Error("rate limited");
      return {
        text: engine === "fake/a" ? "Acme is great, Globex too." : "Use Globex.",
        sources: engine === "fake/a" ? ["https://acme.dev"] : [],
        costUsd: 0.01,
      };
    };

    const summary = await runCitations(config, ask, ledger);

    assert.equal(summary.results.length, 4);
    assert.equal(summary.results.filter((r) => r.error).length, 1);
    assert.equal(Math.round(summary.costUsd * 100), 3);
    const all = (name: string) => summary.shareOfVoice.find((r) => r.engine === "all" && r.name === name);
    assert.deepEqual(all("Acme"), { name: "Acme", engine: "all", answers: 3, cited: 2, mentioned: 2 });
    assert.deepEqual(all("Globex"), { name: "Globex", engine: "all", answers: 3, cited: 0, mentioned: 3 });

    const rows = ledger.db.prepare("SELECT COUNT(*) AS n, SUM(cited) AS cited FROM citation_checks WHERE run_id = ?").get(summary.runId);
    assert.deepEqual({ ...rows }, { n: 3, cited: 2 });
    ledger.close();
  });
});
