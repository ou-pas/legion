// Interview rounds and the single question (07/09). "Round 2 of 3" is computed, and can go wrong
// two ways, both checked here: ordering (by `created_at`, ties by `rowid`, never the random `id`)
// and filtering (task waits, quota and operator pauses are not rounds).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-question-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { inboxQuestion, roundsFrom, isRoundEntry } = await import("./inbox-question.js");
const { INBOX_KIND, INBOX_STATUS, ON_ANSWER } = await import("./inbox-enums.js");
const { WAIT_REASON } = await import("./wait-reason.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type InboxRow = typeof schema.inboxMessages.$inferSelect;
type FormSpec = import("./inbox-form.js").FormSpec;

const SPEC: FormSpec = {
  blocks: [
    { kind: "field", field: { id: "a", label: "A", type: "text" } },
    { kind: "field", field: { id: "b", label: "B", type: "text" } },
  ],
};

/** A complete row, spelt out: a forgotten column must show at compile time. */
const row = (over: Partial<InboxRow> & { id: string }): InboxRow => ({
  sessionId: "s1",
  taskId: "t1",
  agentId: "a1",
  kind: INBOX_KIND.form,
  body: "Round",
  choices: null,
  form: null,
  evidence: null,
  impact: null,
  selectedChoiceId: null,
  answerText: null,
  status: INBOX_STATUS.open,
  onAnswer: ON_ANSWER.resume,
  reason: WAIT_REASON.question,
  waitForTaskId: null,
  grantRepoName: null,
  answeredBy: null,
  wakeAt: null,
  draft: null,
  draftAt: null,
  imageRebuild: null,
  telegramMessageId: null,
  createdAt: new Date(1000),
  answeredAt: null,
  ...over,
});

describe("isRoundEntry, round or notice", () => {
  it("keeps question, approval and diagnostic: all three wait for a gesture", () => {
    assert.ok(isRoundEntry(row({ id: "q", reason: WAIT_REASON.question })));
    assert.ok(isRoundEntry(row({ id: "g", reason: WAIT_REASON.approval })));
    assert.ok(
      isRoundEntry(row({ id: "d", reason: WAIT_REASON.diagnostic, onAnswer: ON_ANSWER.retryTask })),
    );
  });

  it("drops the three notices: dependency, out of quota, operator pause", () => {
    assert.equal(
      isRoundEntry(row({ id: "w", reason: WAIT_REASON.dependency, waitForTaskId: "t2" })),
      false,
    );
    assert.equal(
      isRoundEntry(row({ id: "z", reason: WAIT_REASON.quotaPause, wakeAt: new Date(5000) })),
      false,
    );
    assert.equal(isRoundEntry(row({ id: "p", reason: WAIT_REASON.operatorPause })), false);
  });

  it("lets the field win over the reason: pre-v57 rows have a null `reason`", () => {
    // Otherwise every entry older than the column would count as a round.
    assert.equal(isRoundEntry(row({ id: "old-wait", reason: null, waitForTaskId: "t2" })), false);
    assert.ok(isRoundEntry(row({ id: "old-q", reason: null })));
  });
});

describe("roundsFrom", () => {
  it("keeps the received order: sorting is the caller's", () => {
    const rounds = roundsFrom([
      row({ id: "r1", createdAt: new Date(1000) }),
      row({ id: "r2", createdAt: new Date(2000) }),
      row({ id: "r3", createdAt: new Date(3000) }),
    ]);
    assert.deepEqual(
      rounds.map((r) => r.id),
      ["r1", "r2", "r3"],
    );
  });

  it("drops notices from numbering without gaps", () => {
    const rounds = roundsFrom([
      row({ id: "r1" }),
      row({ id: "sleeps", reason: WAIT_REASON.dependency, waitForTaskId: "t2" }),
      row({ id: "r2" }),
    ]);
    assert.deepEqual(
      rounds.map((r) => r.id),
      ["r1", "r2"],
    );
    assert.equal(rounds.findIndex((r) => r.id === "r2") + 1, 2, "Round 2 of 2, not 3 of 3");
  });

  it("counts from the draft when the question is open", () => {
    const [round] = roundsFrom([
      row({ id: "r", form: JSON.stringify(SPEC), draft: JSON.stringify({ a: "yes" }) }),
    ]);
    assert.deepEqual([round!.fieldCount, round!.answeredCount], [2, 1]);
  });

  it("counts from the answer once sent", () => {
    const [round] = roundsFrom([
      row({
        id: "r",
        status: INBOX_STATUS.answered,
        form: JSON.stringify(SPEC),
        answerText: JSON.stringify({ a: "yes", b: "no" }),
        answeredAt: new Date(4000),
      }),
    ]);
    assert.deepEqual([round!.fieldCount, round!.answeredCount], [2, 2]);
    assert.equal(round!.answeredAt, 4000);
  });

  it("treats a text question as a round without fields", () => {
    const [round] = roundsFrom([row({ id: "r", kind: INBOX_KIND.text, form: null })]);
    assert.deepEqual([round!.fieldCount, round!.answeredCount], [0, 0]);
  });

  it("returns an empty list for a task without rounds", () => {
    assert.deepEqual(roundsFrom([]), []);
    assert.deepEqual(
      roundsFrom([row({ id: "w", reason: WAIT_REASON.dependency, waitForTaskId: "t2" })]),
      [],
    );
  });
});

const now = new Date();
db.insert(schema.runners).values({ id: "rq", name: "rq", kind: RUNNER_KIND.docker }).run();
db.insert(schema.projects).values({ id: "pq", name: "Acme", slug: "pq", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "aq", projectId: "pq", name: "interviewer", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({ id: "tq", projectId: "pq", name: "AI-2200", createdAt: now, updatedAt: now })
  .run();
db.insert(schema.sessions)
  .values({
    id: "sq",
    taskId: "tq",
    agentId: "aq",
    runnerId: "rq",
    model: "opus",
    callbackToken: "tq-tok",
    startedAt: now,
  })
  .run();

const insert = (over: Partial<InboxRow> & { id: string }) =>
  db
    .insert(schema.inboxMessages)
    .values({ ...row(over), sessionId: "sq", taskId: "tq", agentId: "aq" })
    .run();

insert({
  id: "one",
  createdAt: new Date(1000),
  status: INBOX_STATUS.answered,
  form: JSON.stringify(SPEC),
  answerText: JSON.stringify({ a: "x", b: "y" }),
  answeredBy: "human",
  answeredAt: new Date(1500),
});
insert({
  id: "sleeps",
  createdAt: new Date(1800),
  reason: WAIT_REASON.dependency,
  waitForTaskId: "tq",
});
insert({
  id: "two",
  createdAt: new Date(2000),
  form: JSON.stringify(SPEC),
  draft: JSON.stringify({ a: "z" }),
  draftAt: new Date(2500),
});

describe("inboxQuestion", () => {
  it("returns the question, its task, its agent and the interview rounds", () => {
    const q = inboxQuestion("two");
    assert.ok(q);
    assert.equal(q.status, INBOX_STATUS.open);
    assert.deepEqual(q.draft, { a: "z" });
    assert.equal(q.draftAt, 2500);
    assert.equal(q.answer, null);
    assert.equal(q.task?.name, "AI-2200");
    assert.equal(q.task?.projectId, "pq");
    assert.equal(q.agent?.name, "interviewer");
    // The notice is dropped: two rounds, this one second.
    assert.deepEqual(
      q.rounds.map((r) => r.id),
      ["one", "two"],
    );
  });

  it("when answered, reparses the answer from answer_text, with no draft", () => {
    const q = inboxQuestion("one");
    assert.deepEqual(q?.answer?.formData, { a: "x", b: "y" });
    assert.equal(q?.answer?.answeredAt, 1500);
    assert.equal(q?.answer?.answeredBy, "human");
    assert.equal(q?.draft, null);
  });

  it("returns `null` for an unknown id", () => {
    assert.equal(inboxQuestion("never-seen"), null);
  });
});
