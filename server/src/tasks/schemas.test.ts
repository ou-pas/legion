// The tasks domain's bodies are judged, not declared.
//
// The original gap was precise and invisible: `type` was refused by hand when unknown, `complexity`
// and `priority` were not, although all three are ENUM columns. A "huge" complexity reached the
// database, and `task-scales.ts`'s type became wrong for everything reading it (model routing,
// queue order).
//
// No database here: schemas only describe shape, and are tested on bare objects.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBody } from "../http/parse-body.js";
import {
  archiveDoneBody,
  classifyBody,
  createTaskBody,
  DESCRIPTION_MAX,
  moveTaskBody,
  patchTaskBody,
  taskMessageBody,
} from "./schemas.js";
import type { z } from "zod";

/** A route's real path: `parseBody` reads the JSON then applies the schema, and its message is what
 *  a client receives, so that is what is exercised, not bare `safeParse`. */
const read = <T>(schema: z.ZodType<T>, raw: unknown) =>
  parseBody({ req: { json: async () => raw } }, schema);

describe("POST /api/tasks: enum columns are refused when they lie", () => {
  const valid = { name: "set up the harness", agentId: "a1", projectId: "p1" };

  it("accepts the minimum and returns the trimmed title", async () => {
    const parsed = await read(createTaskBody, { ...valid, name: "  set up the harness  " });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.name, "set up the harness");
  });

  for (const [field, bad] of [
    ["complexity", "huge"],
    ["priority", "super-urgent"],
    ["type", "refactoring"],
  ] as const) {
    it(`refuses an unknown ${field}, naming it`, async () => {
      const parsed = await read(createTaskBody, { ...valid, [field]: bad });
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.error, new RegExp(field));
    });
  }

  it("refuses a birth status other than todo/later: a task is not born doing", async () => {
    assert.equal((await read(createTaskBody, { ...valid, status: "doing" })).ok, false);
    assert.equal((await read(createTaskBody, { ...valid, status: "later" })).ok, true);
  });

  it("refuses an unknown key by naming it, rather than silently dropping it", async () => {
    const parsed = await read(createTaskBody, { ...valid, assigneeAgentId: "a1" });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /assigneeAgentId/);
  });

  it("refuses an empty or blank title, and a missing agent", async () => {
    assert.equal((await read(createTaskBody, { ...valid, name: "   " })).ok, false);
    assert.equal((await read(createTaskBody, { name: "x", projectId: "p1" })).ok, false);
  });

  it("refuses an externalRef missing its provider", async () => {
    const parsed = await read(createTaskBody, {
      ...valid,
      externalRef: { provider: "", issueId: "12", identifier: "#12", url: "http://x" },
    });
    assert.equal(parsed.ok, false);
  });

  it("unreadable JSON is a 400 of the same family, never an exception", async () => {
    const parsed = await parseBody(
      { req: { json: () => Promise.reject(new Error("boom")) } },
      createTaskBody,
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /unreadable JSON/);
  });
});

describe("PATCH /api/tasks/:id", () => {
  it('accepts an empty body: the service says "nothing to edit", not the shape', async () => {
    assert.equal((await read(patchTaskBody, {})).ok, true);
  });

  it("refuses a status outside the five", async () => {
    assert.equal((await read(patchTaskBody, { status: "almost" })).ok, false);
    assert.equal((await read(patchTaskBody, { status: "review" })).ok, true);
  });

  it("bounds the brief, and says so with the cap", async () => {
    const parsed = await read(patchTaskBody, { description: "x".repeat(DESCRIPTION_MAX + 1) });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, new RegExp(String(DESCRIPTION_MAX)));
  });

  it("both blocker lists are string arrays, never a lone string", async () => {
    assert.equal((await read(patchTaskBody, { addBlockerIds: "t1" })).ok, false);
    assert.equal(
      (await read(patchTaskBody, { addBlockerIds: ["t1"], removeBlockerIds: [] })).ok,
      true,
    );
  });
});

describe("the four other bodies", () => {
  it("classify needs a non-blank project and title", async () => {
    assert.equal((await read(classifyBody, { projectId: "p1", name: " " })).ok, false);
    assert.equal(
      (await read(classifyBody, { projectId: "p1", name: "x", forced: { gate: null } })).ok,
      true,
    );
  });

  it("a Kanban drop always carries the column and the rank", async () => {
    assert.equal((await read(moveTaskBody, { status: "todo" })).ok, false);
    assert.equal((await read(moveTaskBody, { status: "todo", index: 0 })).ok, true);
  });

  it("archive-done only takes a project, and not an empty one", async () => {
    assert.equal((await read(archiveDoneBody, { projectId: "" })).ok, false);
    assert.equal((await read(archiveDoneBody, { projectId: "p1", status: "done" })).ok, false);
  });

  it("a message is text: a number is not", async () => {
    assert.equal((await read(taskMessageBody, { text: 42 })).ok, false);
    assert.equal((await read(taskMessageBody, { text: "" })).ok, true);
  });
});
