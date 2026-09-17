// Serving a task's files: headers, 404, and refusing a malformed body.
//
// `attachments-http.test.ts` already covers the operator ↔ container round trip. What it does not
// cover lives here: the confinement CSP set on every served file, path traversal refusal, and the
// drop body judged by a schema (an unknown key is named, not ignored).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-routes-artifacts-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { registerTaskRoutes } = await import("./index.js");
const { taskArtifactsDir } = await import("../artifacts/dir.js");
const { TASK_STATUS } = await import("../lifecycle.js");

const app = new Hono();
registerTaskRoutes(app);

const P = "p1";
const A = "a1";
const TASK = "t1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: A, projectId: P, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({
    id: TASK,
    projectId: P,
    name: "idle",
    status: TASK_STATUS.todo,
    assigneeAgentId: A,
    createdAt: now,
    updatedAt: now,
  })
  .run();

/** The run folder as the server computes it; the path is not rebuilt by hand. */
const runDir = taskArtifactsDir(TASK)?.dir ?? "";
assert.ok(runDir, "the run folder must be computable");
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, "report.md"), "# what I did\n");
writeFileSync(join(runDir, "capture.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

describe("the artifact list", () => {
  it("types each file by its extension, so the screen picks its rendering", async () => {
    const files = (await (await app.request(`/api/tasks/${TASK}/artifacts`)).json()) as {
      name: string;
      kind: string;
      mimeType: string;
    }[];
    const rapport = files.find((f) => f.name === "report.md");
    assert.ok(rapport, "the report must be listed");
    assert.equal(rapport.kind, "text");
    assert.match(rapport.mimeType, /markdown|text/);
  });

  it("an unknown task returns 404", async () => {
    assert.equal((await app.request("/api/tasks/never-seen/artifacts")).status, 404);
  });
});

describe("serving a file", () => {
  it("confines every served file with a CSP sandbox: an agent's svg does not drive the API", async () => {
    const res = await app.request(`/api/tasks/${TASK}/artifacts/capture.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts");
  });

  it("refuses path traversal by bringing it back to the run folder", async () => {
    const res = await app.request(
      `/api/tasks/${TASK}/artifacts/${encodeURIComponent("../../../etc/passwd")}`,
    );
    assert.equal(res.status, 404);
  });

  it("an unknown name returns 404, not an empty file", async () => {
    assert.equal((await app.request(`/api/tasks/${TASK}/artifacts/absent.md`)).status, 404);
  });
});

describe("dropping an attachment", () => {
  const attach = (body: unknown) =>
    app.request(`/api/tasks/${TASK}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses an unknown key by naming it, rather than ignoring it", async () => {
    const res = await attach({ name: "notes.md", contentBase64: "eA==", overwrite: true });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /overwrite/);
  });

  it("a file without a name is refused with 422: the body is fine, the file is not", async () => {
    assert.equal((await attach({ contentBase64: "eA==" })).status, 422);
  });

  it("happy path returns 201 and the path the agent will read", async () => {
    const res = await attach({
      name: "instructions.md",
      contentBase64: Buffer.from("# read this\n").toString("base64"),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { attachment: { path: string } };
    assert.equal(body.attachment.path, `/artifacts/${TASK}/attachments/instructions.md`);
  });

  it("the attached file is served confined too", async () => {
    const res = await app.request(`/api/tasks/${TASK}/attachments/instructions.md`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts");
  });
});
