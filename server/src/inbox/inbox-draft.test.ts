// A round's draft (07/09):
//
//  1. The count ("2 / 6"): an unticked checkbox (`false`) is a real answer and counts.
//  2. The boundary: lax on requirements, strict on what protects the database (undeclared keys
//     and oversized values are refused by name). Diverging key lists would lose the work at send
//     time, the worst moment.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-draft-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answeredCount, parseDraft, saveInboxDraft, validateFormDraft } =
  await import("./inbox-draft.js");
const { INBOX_KIND, INBOX_STATUS } = await import("./inbox-enums.js");
const { subscribeAll } = await import("../shared/events.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type FormSpec = import("./inbox-form.js").FormSpec;

/** A choice, a text and a checkbox: the three value families a draft carries. */
const SPEC: FormSpec = {
  blocks: [
    { kind: "markdown", text: "The context." },
    {
      kind: "field",
      field: {
        id: "place",
        label: "Placement",
        type: "radio",
        options: [
          { id: "menu", label: "Menu" },
          { id: "bar", label: "Bar" },
        ],
      },
    },
    { kind: "field", field: { id: "scope", label: "Scope", type: "text" } },
    { kind: "field", field: { id: "persist", label: "Persist", type: "checkbox" } },
  ],
};

describe("answeredCount", () => {
  it("counts fields with a value, not draft keys", () => {
    assert.deepEqual(answeredCount(SPEC, { place: "menu", scope: "customers" }), {
      answered: 2,
      total: 3,
    });
  });

  it("counts an unticked checkbox as answered: `false` is a decision", () => {
    assert.deepEqual(answeredCount(SPEC, { persist: false }), { answered: 1, total: 3 });
  });

  it("does not count whitespace, counts zero", () => {
    assert.deepEqual(answeredCount(SPEC, { scope: "   " }), { answered: 0, total: 3 });
    assert.deepEqual(answeredCount(SPEC, { scope: 0 }), { answered: 1, total: 3 });
  });

  it("does not count the round comment or notes as answers", () => {
    assert.deepEqual(answeredCount(SPEC, { __comment: "keep EN/FR/DE", place__note: "hmm" }), {
      answered: 0,
      total: 3,
    });
  });

  it("without a draft gives the total and zero answered; without a form, all zero", () => {
    assert.deepEqual(answeredCount(SPEC, null), { answered: 0, total: 3 });
    assert.deepEqual(answeredCount(null, { place: "menu" }), { answered: 0, total: 0 });
  });
});

describe("parseDraft", () => {
  it("returns the object, and `null` for anything else", () => {
    assert.deepEqual(parseDraft('{"place":"menu"}'), { place: "menu" });
    assert.equal(parseDraft(null), null);
    // A text question's `answer_text` goes through here and is not JSON.
    assert.equal(parseDraft("answer X instead"), null);
    assert.equal(parseDraft("[1,2]"), null);
  });
});

describe("validateFormDraft", () => {
  it("accepts a partial draft: nothing is required", () => {
    assert.deepEqual(validateFormDraft(SPEC, { place: "menu" }), { place: "menu" });
    assert.deepEqual(validateFormDraft(SPEC, {}), {});
  });

  it("accepts sibling keys: a field note and the round comment", () => {
    const draft = { place__note: "for consistency", __comment: "object case first" };
    assert.deepEqual(validateFormDraft(SPEC, draft), draft);
  });

  it("returns values as-is, empty string included", () => {
    // `validateFormAnswer` would normalise to `null`; a just-erased field would refill itself.
    assert.deepEqual(validateFormDraft(SPEC, { scope: "" }), { scope: "" });
  });

  it("refuses an undeclared key, naming it", () => {
    assert.throws(() => validateFormDraft(SPEC, { unknown: "x" }), /unknown key\(s\): unknown/);
    // A note on a text field is allowed since 08/09; on an undeclared id it stays unknown.
    assert.deepEqual(validateFormDraft(SPEC, { scope__note: "x" }), { scope__note: "x" });
    assert.throws(() => validateFormDraft(SPEC, { other__note: "x" }), /other__note/);
  });

  it("refuses what is not a field value", () => {
    assert.throws(() => validateFormDraft(SPEC, "menu"), /expected an object/);
    assert.throws(() => validateFormDraft(SPEC, [1]), /expected an object/);
    assert.throws(() => validateFormDraft(SPEC, { scope: { a: 1 } }), /text, number or boolean/);
    assert.throws(
      () => validateFormDraft(SPEC, { scope: "x".repeat(10_001) }),
      /10000 characters max/,
    );
  });
});

const RUNNER = "r-draft";
db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker }).run();
const now = new Date();
db.insert(schema.projects).values({ id: "pd", name: "P", slug: "pd", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "ad", projectId: "pd", name: "interviewer", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({ id: "td", projectId: "pd", name: "T", createdAt: now, updatedAt: now })
  .run();
db.insert(schema.sessions)
  .values({
    id: "sd",
    taskId: "td",
    agentId: "ad",
    runnerId: RUNNER,
    model: "haiku",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

function seedAsk(id: string, status: "open" | "answered", form: FormSpec | null = SPEC) {
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId: "sd",
      taskId: "td",
      agentId: "ad",
      kind: INBOX_KIND.form,
      body: "Round 1",
      form: form ? JSON.stringify(form) : null,
      status,
      createdAt: now,
    })
    .run();
}

describe("saveInboxDraft", () => {
  it("writes the draft and returns the count", () => {
    seedAsk("d-ok", INBOX_STATUS.open);
    assert.deepEqual(saveInboxDraft("d-ok", { place: "menu", scope: "customers" }), {
      answered: 2,
      total: 3,
    });
    const row = db
      .select()
      .from(schema.inboxMessages)
      .all()
      .find((r) => r.id === "d-ok");
    assert.deepEqual(JSON.parse(row!.draft!), { place: "menu", scope: "customers" });
    assert.ok(row!.draftAt instanceof Date);
  });

  it("replaces the draft rather than merging: last write wins", () => {
    seedAsk("d-replace", INBOX_STATUS.open);
    saveInboxDraft("d-replace", { place: "menu", scope: "customers" });
    saveInboxDraft("d-replace", { place: "bar" });
    const row = db
      .select()
      .from(schema.inboxMessages)
      .all()
      .find((r) => r.id === "d-replace");
    assert.deepEqual(JSON.parse(row!.draft!), { place: "bar" });
  });

  it("refuses a question no longer open (the route answers 409)", () => {
    seedAsk("d-closed", INBOX_STATUS.answered);
    assert.throws(
      () => saveInboxDraft("d-closed", { place: "menu" }),
      /the question is no longer open/,
    );
  });

  it("refuses a question without a form and an unknown id", () => {
    seedAsk("d-none", INBOX_STATUS.open, null);
    assert.throws(() => saveInboxDraft("d-none", { place: "menu" }), /has no form/);
    assert.throws(() => saveInboxDraft("d-absent", {}), /not found/);
  });

  it("broadcasts `inbox_draft` with the count, never the values", () => {
    seedAsk("d-event", INBOX_STATUS.open);
    const received: { sessionId: string; type: string; payload: unknown }[] = [];
    const stop = subscribeAll((sessionId, ev) =>
      received.push({ sessionId, type: ev.type, payload: ev.payload }),
    );
    saveInboxDraft("d-event", { place: "menu", scope: "secret" });
    stop();
    const ev = received.filter((e) => e.type === "inbox_draft").pop();
    assert.ok(ev, "the event must be broadcast");
    assert.deepEqual(ev.payload, { inboxId: "d-event", answered: 2, total: 3 });
  });

  // 16/09: stored, the draft put ten identical lines in fifty seconds on the session trace.
  it("writes nothing to the session trace, even repeated", () => {
    seedAsk("d-silent", INBOX_STATUS.open);
    const before = db.select().from(schema.sessionEvents).all().length;
    for (let i = 0; i < 5; i += 1) saveInboxDraft("d-silent", { place: "menu" });
    const lines = db.select().from(schema.sessionEvents).all();
    assert.equal(lines.length, before, "no extra line");
    assert.equal(lines.filter((e) => e.type === "inbox_draft").length, 0);
  });
});
