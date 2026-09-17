// End to end: an agent drops a PNG through the internal fs channel, it lands intact on the control
// plane's disk (identical sha256), and the task page's HTTP API serves it with the right
// content-type, never as implicit text/html, never truncated. Same mount as
// `sessions/artifacts-location.test.ts` (in-memory Hono, database/disk in a temporary folder).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-artifacts-binary-http-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerInternalRoutes } = await import("../sessions/internal-routes.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerInternalRoutes(app);
registerTaskRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1";
const SESSION = "s1";
const TOKEN = "tok-1";

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: AGENT, projectId: PROJECT, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners)
  .values({ id: "r1", name: "local", kind: RUNNER_KIND.docker, dockerHost: null })
  .run();
db.insert(schema.tasks)
  .values({
    id: TASK,
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
    id: SESSION,
    taskId: TASK,
    agentId: AGENT,
    runnerId: "r1",
    model: "sonnet",
    status: "running",
    callbackToken: TOKEN,
    startedAt: now,
  })
  .run();

const sha256 = (buf: ArrayBuffer | Buffer) =>
  createHash("sha256")
    .update(Buffer.from(buf as ArrayBuffer))
    .digest("hex");

// A real 1x1 PNG, not invented bytes: its signature is not valid UTF-8, exactly the case the old
// path (forced "utf8") corrupted.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const writeFs = (path: string, body: Record<string, unknown>) =>
  app.request(`/internal/sessions/${SESSION}/fs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ op: "write", path, ...body }),
  });

describe("a binary artifact, from agent write to HTTP rendering", () => {
  it("a PNG dropped via contentBase64 lands on disk, identical bytes (sha256)", async () => {
    const res = await writeFs("capture.png", { contentBase64: PNG.toString("base64") });
    assert.equal(res.status, 200, `write refused: ${await res.text()}`);

    const served = await app.request(`/api/tasks/${TASK}/artifacts/capture.png`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get("content-type") ?? "", /^image\/png/);
    // Never a content-disposition attachment for an image: it previews inline.
    assert.equal(served.headers.get("content-disposition"), null);
    const bytes = await served.arrayBuffer();
    assert.equal(sha256(bytes), sha256(PNG), "the served bytes differ from the dropped ones");
    assert.equal(bytes.byteLength, PNG.length);
  });

  it("the list tells text from binary by extension, with the right mimeType", async () => {
    const textRes = await writeFs("pr.md", { content: "# title\n" });
    assert.equal(textRes.status, 200);
    const zipRes = await writeFs("export.zip", {
      contentBase64: Buffer.from("PK\x03\x04").toString("base64"),
    });
    assert.equal(zipRes.status, 200);

    const listRes = await app.request(`/api/tasks/${TASK}/artifacts`);
    const list = (await listRes.json()) as {
      name: string;
      size: number;
      mimeType: string;
      kind: string;
    }[];
    const byName = Object.fromEntries(list.map((a) => [a.name, a]));

    assert.equal(byName["capture.png"]?.kind, "image");
    assert.equal(byName["capture.png"]?.mimeType, "image/png");
    assert.equal(byName["pr.md"]?.kind, "text");
    assert.equal(byName["export.zip"]?.kind, "binary");
    assert.equal(byName["export.zip"]?.mimeType, "application/octet-stream");
  });

  it("a non-image binary is served as octet-stream with content-disposition attachment (download, never inline)", async () => {
    const served = await app.request(`/api/tasks/${TASK}/artifacts/export.zip`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get("content-type") ?? "", /^application\/octet-stream/);
    assert.match(
      served.headers.get("content-disposition") ?? "",
      /^attachment; filename="export\.zip"/,
    );
  });

  it("refuses a binary drop over the named cap, and says so", async () => {
    const tooBig = Buffer.alloc(9 * 1024 * 1024, 1);
    const res = await writeFs("too-big.bin", { contentBase64: tooBig.toString("base64") });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /binary content too large \(\d+ > 8388608\)/);
  });
});
