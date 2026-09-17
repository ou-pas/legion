// One failing notifier (Discord offline, expired token) must neither stop the next ones nor reach
// the caller: the question exists in the database, announcing it is extra.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-notifiers-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const {
  broadcastText,
  hasTextNotifier,
  notifyInboxAnswered,
  notifyInboxCreated,
  registerNotifier,
} = await import("./notifiers.js");
const { INBOX_KIND } = await import("./inbox-enums.js");

const CREATED = {
  id: "i1",
  kind: INBOX_KIND.text,
  body: "shall we continue?",
  choices: null,
  blocking: true,
  taskName: "t",
  agentName: "a",
};

/** The registry is module state: not reset between cases, observed as it grows. */
const seen: string[] = [];

describe("notifier registry", () => {
  it("has no text broadcaster until a notifier offers one", () => {
    assert.equal(hasTextNotifier(), false);
  });

  it("calls every notifier, even after one rejects", async () => {
    registerNotifier({ notifyInbox: () => Promise.reject(new Error("discord offline")) });
    registerNotifier({
      notifyInbox: async (m) => {
        seen.push(`inbox:${m.id}`);
      },
      notifyAnswered: async (id) => {
        seen.push(`answered:${id}`);
      },
      notifyText: async (t) => {
        seen.push(`text:${t}`);
      },
    });

    notifyInboxCreated(CREATED);
    notifyInboxAnswered("i1", "yes");
    broadcastText("standup");
    await new Promise((r) => setTimeout(r, 10)); // announcements are fired, not awaited

    assert.deepEqual(seen, ["inbox:i1", "answered:i1", "text:standup"]);
  });

  it("now knows a text broadcaster exists", () => {
    assert.equal(hasTextNotifier(), true);
  });
});
