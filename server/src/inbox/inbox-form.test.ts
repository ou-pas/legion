// Inbox forms (v31, 24/08):
//
//  1. The spec is validated on creation with a named refusal the agent reads and fixes.
//  2. The answer is validated against the agent's schema (required, bounds, options, unknown keys).
//  3. Obvious SVG is refused early (a belt; DOMPurify at render is the boundary).
//  4. End to end: a form question pauses the session, a formData answer resumes it with normalised
//     JSON, and free text always overrides (human first).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-form-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { validateFormSpec, validateFormAnswer, formFields, FORM_COMMENT_KEY } =
  await import("./inbox-form.js");
const { createInboxMessage, answerInbox } = await import("./inbox.js");
const { resumeSession, runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
// A test that answers an inbox entry wires the resume port itself, with the real implementation.
const { registerSessionResumer } = await import("./ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND } = await import("./inbox-enums.js");
const { INBOX_STATUS } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
let resumed: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    resumed = spec;
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const FIELD = (over: Record<string, unknown> = {}) => ({
  kind: "field",
  field: {
    id: INBOX_KIND.choice,
    label: "Strategy",
    type: "radio",
    required: true,
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    ...over,
  },
});
const SPEC = {
  blocks: [
    { kind: "markdown", text: "context" },
    { kind: "svg", svg: '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>' },
    FIELD(),
    { kind: "field", field: { id: "budget", label: "Budget", type: "number", min: 0, max: 10 } },
    { kind: "field", field: { id: "dry", label: "Dry-run", type: "checkbox" } },
  ],
};

describe("validateFormSpec, named refusals and normalised spec", () => {
  it("accepts a full spec and normalises ids", () => {
    const spec = validateFormSpec({ blocks: [FIELD({ id: "my pick!" })] });
    const f = spec.blocks[0]!;
    assert.equal(f.kind === "field" && f.field.id, "my_pick_");
  });
  it("refuses: no field", () => {
    assert.throws(
      () => validateFormSpec({ blocks: [{ kind: "markdown", text: "x" }] }),
      /at least one field/,
    );
  });
  it("refuses: duplicate ids, naming them", () => {
    assert.throws(() => validateFormSpec({ blocks: [FIELD(), FIELD()] }), /“choice”: duplicate id/);
  });
  it("refuses: select without options", () => {
    assert.throws(
      () => validateFormSpec({ blocks: [FIELD({ type: "select", options: [] })] }),
      /at least 2 options/,
    );
  });
  it("refuses: unknown type", () => {
    assert.throws(() => validateFormSpec({ blocks: [FIELD({ type: "file" })] }), /unknown type/);
  });
  it("refuses: svg with script or foreignObject (belt; the boundary is at render)", () => {
    for (const svg of [
      "<svg><script>x</script></svg>",
      "<svg><foreignObject/></svg>",
      '<svg href="javascript:x"/>',
    ])
      assert.throws(
        () => validateFormSpec({ blocks: [{ kind: "svg", svg }, FIELD()] }),
        /svg refused/,
      );
  });
  it("refuses: min > max on a number", () => {
    assert.throws(
      () =>
        validateFormSpec({
          blocks: [FIELD({ type: "number", min: 5, max: 1, options: undefined })],
        }),
      /min > max/,
    );
  });
});

describe("validateFormAnswer, the submission holds the declared schema", () => {
  const spec = validateFormSpec(SPEC);
  it("normalises a full answer (number from a string, unticked checkbox = false)", () => {
    const out = validateFormAnswer(spec, { choice: "a", budget: "7", dry: false });
    assert.deepEqual(out, { choice: "a", budget: 7, dry: false });
  });
  it("turns a missing optional field into null, never a missing key", () => {
    const out = validateFormAnswer(spec, { choice: "b" });
    assert.deepEqual(out, { choice: "b", budget: null, dry: false });
  });
  it("refuses: missing required field, naming the label the human sees", () => {
    assert.throws(() => validateFormAnswer(spec, { budget: 3 }), /“Strategy” required/);
  });
  it("refuses: value outside the options", () => {
    assert.throws(() => validateFormAnswer(spec, { choice: "z" }), /is not an option/);
  });
  it("refuses: number out of bounds", () => {
    assert.throws(() => validateFormAnswer(spec, { choice: "a", budget: 99 }), /maximum 10/);
  });
  it("refuses: unknown key, naming it", () => {
    assert.throws(
      () => validateFormAnswer(spec, { choice: "a", ghost: 1 }),
      /unknown key\(s\): ghost/,
    );
  });
});

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  resumed = null;
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: PROJECT,
      name: "task",
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "s1",
      taskId: "t1",
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: "running",
      callbackToken: "tok",
      mock: true,
      sdkSessionId: "sdk",
      startedAt: now,
    })
    .run();
}

const sessionRow = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, "s1")).get()!;

describe("inbox, a form question from pause to resume", () => {
  beforeEach(() => reset());

  it("creating pauses the session; a formData answer resumes it with normalised JSON", async () => {
    const created = createInboxMessage("s1", {
      kind: INBOX_KIND.form,
      body: "Three decisions at once",
      form: validateFormSpec(SPEC),
    });
    assert.equal(created.kind, INBOX_KIND.form);
    assert.equal(sessionRow().status, SESSION_STATUS.waiting);
    const answer = await answerInbox(created.id, {
      formData: { choice: "a", budget: 4, dry: true },
    });
    assert.equal(answer, JSON.stringify({ choice: "a", budget: 4, dry: true }));
    await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
    assert.ok(resumed, "the session was resumed");
    assert.ok(resumed.resume?.prompt.includes('"budget":4'), "the resume prompt carries the JSON");
  });

  it("refuses an invalid submission before any write: the question stays open", async () => {
    const created = createInboxMessage("s1", {
      kind: INBOX_KIND.form,
      body: "q",
      form: validateFormSpec(SPEC),
    });
    await assert.rejects(
      () => answerInbox(created.id, { formData: { choice: "z" } }),
      /is not an option/,
    );
    const row = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, created.id))
      .get()!;
    assert.equal(row.status, INBOX_STATUS.open);
    assert.equal(row.answeredAt, null);
  });

  it("lets free text override the form (human first)", async () => {
    const created = createInboxMessage("s1", {
      kind: INBOX_KIND.form,
      body: "q",
      form: validateFormSpec(SPEC),
    });
    const answer = await answerInbox(created.id, {
      text: "no, go with option C instead, here is why: …",
    });
    assert.match(answer, /option C/);
  });

  it("refuses formData on a question without a form, by name", async () => {
    const created = createInboxMessage("s1", { kind: INBOX_KIND.text, body: "simple question" });
    await assert.rejects(() => answerInbox(created.id, { formData: { x: 1 } }), /has no form/);
  });
});

// Pre-filled recommendation and comments (25/08), both born from a seven-question round with no
// pre-selected answer and nowhere to write "yes, but…".
describe("default, the recommendation set on the control", () => {
  const radio = (extra: Record<string, unknown>) => ({
    blocks: [
      {
        kind: "field",
        field: {
          id: "q1",
          label: "Starting point",
          type: "radio",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          ...extra,
        },
      },
    ],
  });

  it("keeps a valid option id", () => {
    const spec = validateFormSpec(radio({ default: "b" }));
    assert.equal(formFields(spec)[0]!.default, "b");
  });

  it("refuses a default naming no option, listing the valid ids", () => {
    assert.throws(() => validateFormSpec(radio({ default: "z" })), /is not an option id.*a, b/s);
  });

  it("sets nothing without a default", () => {
    assert.equal(formFields(validateFormSpec(radio({})))[0]!.default, undefined);
  });

  it("requires a boolean for a checkbox, not a string", () => {
    const box = (d: unknown) => ({
      blocks: [{ kind: "field", field: { id: "q", label: "L", type: "checkbox", default: d } }],
    });
    assert.equal(formFields(validateFormSpec(box(true)))[0]!.default, true);
    assert.throws(() => validateFormSpec(box("yes")), /boolean/);
  });

  it("accepts a whole reason in the hint: 160 characters cut recommendations in half", () => {
    const long = "recommended: both, because ".padEnd(320, "x");
    const spec = validateFormSpec(radio({ hint: long }));
    assert.equal(formFields(spec)[0]!.hint!.length, 320, "the reason outlives a label's size");
  });
});

describe("the comment attached to an answer", () => {
  const spec = validateFormSpec({
    blocks: [
      {
        kind: "field",
        field: {
          id: "pick",
          label: "Pick",
          type: "radio",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      },
      { kind: "field", field: { id: "free", label: "Free", type: "textarea" } },
    ],
  });

  it("returns to the agent under a sibling key; the answer stays the answer", () => {
    const out = validateFormAnswer(spec, {
      pick: "a",
      pick__note: "fine, but only if X",
      free: "",
    });
    assert.equal(out.pick, "a", "the agent's declared key keeps its shape");
    assert.equal(out.pick__note, "fine, but only if X");
  });

  it("drops an empty comment, which would be noise in the resume prompt", () => {
    const out = validateFormAnswer(spec, { pick: "a", pick__note: "   ", free: "" });
    assert.equal("pick__note" in out, false);
  });

  it("allows commenting without deciding", () => {
    const out = validateFormAnswer(spec, {
      pick: "",
      pick__note: "either works, you decide",
      free: "",
    });
    assert.equal(out.pick, null);
    assert.equal(out.pick__note, "either works, you decide");
  });

  it("lets a comment argue: 10 000 characters, not 2 000", () => {
    // The first serious use hit 2 600 characters correcting a seventeen-decision summary.
    const out = validateFormAnswer(spec, { pick: "a", pick__note: "x".repeat(9_000), free: "" });
    assert.equal((out.pick__note as string).length, 9_000);
    assert.throws(
      () => validateFormAnswer(spec, { pick: "a", pick__note: "x".repeat(10_001), free: "" }),
      /10000 characters max/,
    );
  });

  it("accepts a note on a free field too (08/09): the value is the answer, the note the doubt", () => {
    const out = validateFormAnswer(spec, {
      pick: "a",
      free: "x",
      free__note: "unsure of the name",
    });
    assert.equal(out.free, "x");
    assert.equal(out.free__note, "unsure of the name");
    // On an undeclared id the note stays an unknown key.
    assert.throws(() => validateFormAnswer(spec, { pick: "a", other__note: "?" }), /unknown/);
  });
});

// The round comment (07/09): one comment at the summary, travelling under `__comment` in the same
// JSON as the answers.
describe("the round comment, under `__comment`", () => {
  const spec = validateFormSpec({
    blocks: [
      {
        kind: "field",
        field: {
          id: "pick",
          label: "Pick",
          type: "radio",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      },
      { kind: "field", field: { id: "free", label: "Free", type: "textarea" } },
    ],
  });

  it("returns to the agent next to the answers", () => {
    const out = validateFormAnswer(spec, {
      pick: "a",
      free: "",
      [FORM_COMMENT_KEY]: "object case first",
    });
    assert.equal(out.pick, "a");
    assert.equal(out[FORM_COMMENT_KEY], "object case first");
  });

  it("is dropped when empty or blank", () => {
    const out = validateFormAnswer(spec, { pick: "a", free: "", [FORM_COMMENT_KEY]: "  " });
    assert.equal(FORM_COMMENT_KEY in out, false);
  });

  it("has the same cap and type as a field comment, measured after trimming", () => {
    assert.throws(
      () => validateFormAnswer(spec, { pick: "a", [FORM_COMMENT_KEY]: "x".repeat(10_001) }),
      /10000 characters max/,
    );
    assert.throws(
      () => validateFormAnswer(spec, { pick: "a", [FORM_COMMENT_KEY]: 42 }),
      /text expected/,
    );
    const padded = validateFormAnswer(spec, {
      pick: "a",
      [FORM_COMMENT_KEY]: `   ${"x".repeat(10_000)}   `,
    });
    assert.equal((padded[FORM_COMMENT_KEY] as string).length, 10_000);
  });

  it("refuses a field named `__comment` or ending in `__note`: the key would be read twice", () => {
    assert.throws(
      () =>
        validateFormSpec({
          blocks: [
            { kind: "field", field: { id: FORM_COMMENT_KEY, label: "X", type: "checkbox" } },
          ],
        }),
      /“__comment”: reserved id/,
    );
    assert.throws(
      () =>
        validateFormSpec({
          blocks: [{ kind: "field", field: { id: "pick__note", label: "X", type: "text" } }],
        }),
      /“pick__note”: reserved id/,
    );
  });
});
