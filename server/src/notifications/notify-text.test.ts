// The sentence read on a lock screen (13/09). Two facts that break silently: an event with no
// named case would return an empty string (a mute notification), and a task name outside latin-1
// would make `fetch` throw while writing the header, losing the notification over an emoji.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOTIF_EVENT, NOTIF_EVENTS, PAUSE_CAUSE } from "./notify-enums.js";
import { headerSafe, pushText, summarizeNotif } from "./notify-text.js";

describe("summarizeNotif", () => {
  it("names the task whichever field the emitter used", () => {
    assert.equal(
      summarizeNotif("gate_waiting", { task: "Redesign" }),
      "An approval is waiting for you · Redesign",
    );
    // `lifecycle.ts` sends `task`, `stalled-start.ts` sends `taskName`, `goals.ts` sends `name`.
    assert.equal(summarizeNotif("task_failed", { taskName: "Redesign" }), "Task failed · Redesign");
    assert.equal(summarizeNotif("goal_stopped", { name: "Redesign" }), "Goal stopped · Redesign");
  });

  it("returns a non-empty sentence for every subscribable event", () => {
    for (const event of NOTIF_EVENTS) {
      const line = summarizeNotif(event, {});
      assert.ok(line.length > 0, `${event} returns nothing`);
      // The default returns the event name: a written sentence must never fall through to it.
      assert.notEqual(line, event, `${event} has no named case`);
    }
  });

  it("does not pretend to know a name it was not given", () => {
    assert.equal(summarizeNotif("pr_created", {}), "PR opened · unnamed");
  });
});

describe("headerSafe", () => {
  // Accented on purpose: these characters are in latin-1 and must survive.
  it("keeps accents, which are in latin-1", () => {
    assert.equal(headerSafe("Café résumé · Redesign"), "Café résumé · Redesign");
  });

  it("removes what an HTTP header cannot carry", () => {
    assert.equal(headerSafe("Task 🚀 failed"), "Task  failed"); // emoji (surrogate pair)
    assert.equal(headerSafe("Task 日本 here"), "Task  here"); // outside latin-1
    assert.equal(headerSafe("one\nline"), "oneline"); // a newline would cut the header
  });

  it("caps the length and never returns empty", () => {
    assert.equal(headerSafe("é".repeat(500)).length, 200);
    assert.equal(headerSafe("🚀"), "Legion");
    assert.equal(headerSafe(""), "Legion");
  });
});

describe("pushText", () => {
  it("splits the summary at the middle dot: what is happening, then what about", () => {
    assert.deepEqual(pushText("gate_waiting", { task: "Rail redesign" }), {
      title: "An approval is waiting for you",
      body: "Rail redesign",
    });
  });

  // An event with no named case returns its own name, with no middle dot. An empty body beats an
  // empty title: iOS does not show a notification without a title at all.
  it("keeps everything in the title when there is no middle dot", () => {
    const { title, body } = pushText("dependency_wait", {});
    assert.ok(title.length > 0);
    assert.equal(typeof body, "string");
  });

  it("never returns an empty title for any subscribable event", () => {
    for (const event of NOTIF_EVENTS) assert.ok(pushText(event, {}).title.trim().length > 0);
  });
});

describe("pushText, the project", () => {
  // iOS already prefixes the title with the app name, so the project goes in the body.
  it("puts the project at the head of the body, never in the title", () => {
    assert.deepEqual(pushText("gate_waiting", { task: "Redesign", project: "Legion" }), {
      title: "An approval is waiting for you",
      body: "Legion · Redesign",
    });
  });

  it("does without the project when it is unknown", () => {
    assert.deepEqual(pushText("gate_waiting", { task: "Redesign" }), {
      title: "An approval is waiting for you",
      body: "Redesign",
    });
  });

  it("adds no separator when there is only the project", () => {
    const { body } = pushText("dependency_wait", { project: "Legion" });
    assert.ok(!body.endsWith(" · "));
    assert.ok(body.includes("Legion"));
  });
});

// The unrequested pause (14/09). `pushText` splits at the middle dot, so the order (count first,
// cause second) is the contract: the count must be readable without unlocking.
describe("summarizeNotif, the system pause", () => {
  it("puts the count in the title and the cause in the body", () => {
    assert.deepEqual(
      pushText(NOTIF_EVENT.systemPause, {
        cause: PAUSE_CAUSE.update,
        count: 3,
        version: "v1.9.5",
      }),
      { title: "3 sessions suspended", body: "update to v1.9.5" },
    );
  });

  // An update can start without a readable target: no "to undefined".
  it("does without the version when it is unknown", () => {
    assert.equal(
      summarizeNotif(NOTIF_EVENT.systemPause, { cause: PAUSE_CAUSE.update, count: 1 }),
      "1 session suspended · update",
    );
  });

  it("names an unknown cause instead of returning an empty body", () => {
    const { body } = pushText(NOTIF_EVENT.systemPause, { cause: "something-else", count: 2 });
    assert.equal(body, "unknown cause");
  });
});
