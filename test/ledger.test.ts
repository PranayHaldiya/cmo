import assert from "node:assert/strict";
import { it } from "node:test";
import { Ledger } from "../src/ledger/db.ts";

it("compares citation rate before and after a merged fix", () => {
  const ledger = new Ledger(":memory:");
  const check = (day: string, cited: boolean) =>
    ledger.recordCitation({ checkedAt: `2026-10-${day}T09:00:00.000Z`, engine: "test", prompt: "best x", cited });

  check("01", false);
  check("05", false);
  check("08", true);
  check("12", true);
  check("15", true);
  check("18", false);

  const id = ledger.recordFix({ kind: "llms-txt", url: "/", files: ["public/llms.txt"], openedAt: "2026-10-09T00:00:00.000Z" });
  assert.equal(ledger.fixImpact(id), null, "unmerged fixes have no impact window");

  ledger.markMerged(id, "2026-10-10T00:00:00.000Z");
  const impact = ledger.fixImpact(id, 10)!;
  assert.deepEqual(impact.before, { checks: 3, citationRate: 1 / 3 });
  assert.deepEqual(impact.after, { checks: 3, citationRate: 2 / 3 });
  ledger.close();
});
