// The cap of 5 pending suggestions per project (`suggestRuleFromCorrection`) must say so in the
// control plane log (04/09): on 03/09 five pending suggestions blocked every new one without a
// trace.
//
// SQLite only: the quota guard returns before the first `await import(
// "@anthropic-ai/claude-agent-sdk")`, so no network is needed.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-rulequota-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, listControlEvents, schema } = await import("../shared/db.js");
const { suggestRuleFromCorrection } = await import("./capabilities.js");
const { RULE_STATUS } = await import("./agent/agent-enums.js");

const PROJECT = "p-quota";

it("logs the saturated 5-suggestion cap in the control plane log", async () => {
  const now = new Date();
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "P", slug: "p-quota", createdAt: now })
    .run();
  for (let i = 0; i < 5; i++) {
    db.insert(schema.rules)
      .values({
        id: `r-${i}`,
        projectId: PROJECT,
        name: `suggestion ${i}`,
        content: "x",
        allAgents: false,
        status: RULE_STATUS.suggested,
        createdAt: now,
      })
      .run();
  }

  // Returns without throwing and without calling the SDK.
  await suggestRuleFromCorrection({
    projectId: PROJECT,
    agentName: "agent",
    question: "q",
    answer: "some reasonably long answer",
  });

  const rules = db.select().from(schema.rules).where(eq(schema.rules.projectId, PROJECT)).all();
  assert.equal(rules.length, 5, "the quota still blocks a 6th suggestion");

  const events = listControlEvents({ limit: 50 }).filter((e) => e.source === "memory");
  assert.equal(events.length, 1, "an event must report the saturated quota");
  assert.equal(events[0]!.level, "warn");
  assert.match(events[0]!.message, /quota/i);
  assert.match(events[0]!.message, new RegExp(PROJECT));
});
