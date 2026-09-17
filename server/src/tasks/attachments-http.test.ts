// End to end, in the slice's direction: the operator attaches a file to the brief through the task
// page API, the container reads it back through the /internal port with its session token (an image
// coming back as bytes, not utf8 mush), and the artifact list never confuses an attached file with
// an agent deliverable. Same mount as `artifacts-binary-http.test.ts` (in-memory Hono,
// database/disk in a temporary folder). Accented file names below are deliberate: sanitising is
// under test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-attachments-http-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerInternalRoutes } = await import("../sessions/internal-routes.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { MAX_ATTACHMENT_BYTES } = await import("./attachments.js");
const { takePendingSteers } = await import("../sessions/steering.js");
const { flushAttachmentNotices } = await import("./attachment-notify.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerInternalRoutes(app);
registerTaskRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1"; // idle task: the file waits for the next session
const LIVE_TASK = "t2"; // task whose session listens: the file is announced to it
const WAITING_TASK = "t3"; // task whose session is paused: dropped, but nobody to notify
const SESSION = "s1";
const WAITING_SESSION = "s2";
const TOKEN = "tok-1";

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: AGENT, projectId: PROJECT, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners)
  .values({ id: "r1", name: "local", kind: RUNNER_KIND.docker, dockerHost: null })
  .run();
for (const [id, status] of [
  [TASK, TASK_STATUS.todo],
  [LIVE_TASK, TASK_STATUS.doing],
  [WAITING_TASK, TASK_STATUS.doing],
] as const)
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
// The live session belongs to LIVE_TASK; TASK must stay reachable without announcing anything.
db.insert(schema.sessions)
  .values({
    id: SESSION,
    taskId: LIVE_TASK,
    agentId: AGENT,
    runnerId: "r1",
    model: "sonnet",
    status: "running",
    callbackToken: TOKEN,
    startedAt: now,
  })
  .run();
db.insert(schema.sessions)
  .values({
    id: WAITING_SESSION,
    taskId: WAITING_TASK,
    agentId: AGENT,
    runnerId: "r1",
    model: "sonnet",
    status: "waiting",
    callbackToken: "tok-2",
    startedAt: now,
  })
  .run();

type Uploaded = {
  attachment: { name: string; kind: string; path: string };
  replaced: boolean;
  notified: "steered" | "none";
  sessionId?: string;
  reason?: string;
};

const sha256 = (buf: ArrayBuffer | Buffer) =>
  createHash("sha256")
    .update(Buffer.from(buf as ArrayBuffer))
    .digest("hex");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const attach = (taskId: string, name: string, bytes: Buffer) =>
  app.request(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, contentBase64: bytes.toString("base64") }),
  });

// The container reads with its session token, the same call as `fs_read` on the payload side.
const readAsContainer = (path: string) =>
  app.request(`/internal/sessions/${SESSION}/fs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ op: "read", path }),
  });

describe("outbound: the operator attaches a file to the brief", () => {
  it("an attached PNG comes back in the list, typed, under the path the agent will read", async () => {
    const res = await attach(TASK, "Capture d'écran 2026-09-02.png", PNG);
    const body = (await res.json()) as Uploaded;
    assert.equal(res.status, 201, `refused: ${JSON.stringify(body)}`);
    assert.equal(body.attachment.name, "Capture-d-ecran-2026-09-02.png");
    assert.equal(body.attachment.kind, "image");
    assert.equal(
      body.attachment.path,
      `/artifacts/${TASK}/attachments/Capture-d-ecran-2026-09-02.png`,
    );
    assert.equal(body.replaced, false);
    assert.equal(
      body.notified,
      "none",
      "idle, nobody to notify: the next session will read the brief",
    );

    const list = (await (await app.request(`/api/tasks/${TASK}/attachments`)).json()) as {
      name: string;
    }[];
    assert.deepEqual(
      list.map((a) => a.name),
      ["Capture-d-ecran-2026-09-02.png"],
    );
  });

  it("the Artifacts view does not confuse them: the artifact list stays empty, the subfolder does not get in", async () => {
    const artifacts = (await (
      await app.request(`/api/tasks/${TASK}/artifacts`)
    ).json()) as unknown[];
    assert.deepEqual(artifacts, [], "an operator-attached file is not an agent deliverable");
  });

  it("the screen serves it as bytes, with the right content-type and no forced attachment for an image", async () => {
    const served = await app.request(
      `/api/tasks/${TASK}/attachments/Capture-d-ecran-2026-09-02.png`,
    );
    assert.equal(served.status, 200);
    assert.match(served.headers.get("content-type") ?? "", /^image\/png/);
    assert.equal(served.headers.get("content-disposition"), null);
    assert.equal(sha256(await served.arrayBuffer()), sha256(PNG));
  });

  it("refuses beyond the named cap, and says so", async () => {
    const res = await attach(TASK, "too-big.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1));
    assert.equal(res.status, 422);
    assert.match(
      ((await res.json()) as { error: string }).error,
      new RegExp(`${MAX_ATTACHMENT_BYTES}`),
    );
  });

  it("a task whose session listens accepts the attachment and announces it, exact path included", async () => {
    const res = await attach(LIVE_TASK, "capture oubliée.png", PNG);
    const body = (await res.json()) as Uploaded;
    assert.equal(res.status, 201, `refused: ${JSON.stringify(body)}`);
    assert.equal(body.notified, "steered");
    assert.equal(body.sessionId, SESSION);

    flushAttachmentNotices(SESSION); // held 1.5 s in production, to group a burst
    const steers = takePendingSteers(SESSION);
    assert.equal(steers.length, 1, "one drop = one queued message, neither zero nor two");
    assert.match(steers[0]?.text ?? "", /capture-oubliee\.png/);
    assert.match(
      steers[0]?.text ?? "",
      new RegExp(`/artifacts/${LIVE_TASK}/attachments/capture-oubliee\\.png`),
    );
    assert.match(steers[0]?.text ?? "", /fs_read/);
  });

  it("three drops in a row: one message naming the three paths", async () => {
    for (const n of ["one.png", "two.png", "three.png"])
      assert.equal((await attach(LIVE_TASK, n, PNG)).status, 201);
    flushAttachmentNotices(SESSION);
    const steers = takePendingSteers(SESSION);
    assert.equal(steers.length, 1, "three files = one message, not three");
    for (const n of ["one.png", "two.png", "three.png"])
      assert.match(steers[0]?.text ?? "", new RegExp(`/artifacts/${LIVE_TASK}/attachments/${n}`));
  });

  it("a paused session does not listen: the file is dropped anyway, and the response says why nobody is notified", async () => {
    const res = await attach(WAITING_TASK, "for-later.md", Buffer.from("# later"));
    const body = (await res.json()) as Uploaded;
    assert.equal(res.status, 201, `refused: ${JSON.stringify(body)}`);
    assert.equal(body.notified, "none");
    assert.match(body.reason ?? "", /pause/);
    assert.equal(
      takePendingSteers(WAITING_SESSION).length,
      0,
      "nothing queued for a destroyed runtime",
    );
    const list = (await (await app.request(`/api/tasks/${WAITING_TASK}/attachments`)).json()) as {
      name: string;
    }[];
    assert.deepEqual(
      list.map((a) => a.name),
      ["for-later.md"],
    );
  });

  it("an unknown task returns 404 rather than writing somewhere", async () => {
    assert.equal((await attach("unknown", "x.md", Buffer.from("x"))).status, 404);
  });
});

describe("transmission: the container pulls the attachment through /internal", () => {
  it("an image comes back as encoded bytes with its MIME type, never corrupted utf8", async () => {
    const res = await readAsContainer(`/artifacts/${LIVE_TASK}/attachments/capture.png`);
    // The file belongs to the live session's run: drop it from the agent side first.
    assert.equal(res.status, 422, "the file does not exist yet: the read must fail cleanly");

    const write = await app.request(`/internal/sessions/${SESSION}/fs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        op: "write",
        path: `/artifacts/${LIVE_TASK}/attachments/capture.png`,
        contentBase64: PNG.toString("base64"),
      }),
    });
    assert.equal(write.status, 200, await write.text());

    const read = await readAsContainer(`/artifacts/${LIVE_TASK}/attachments/capture.png`);
    assert.equal(read.status, 200);
    const body = (await read.json()) as {
      result: { contentBase64: string; bytes: number; mimeType: string };
    };
    assert.equal(body.result.mimeType, "image/png");
    assert.equal(body.result.bytes, PNG.length);
    assert.equal(
      sha256(Buffer.from(body.result.contentBase64, "base64")),
      sha256(PNG),
      "the bytes returned to the container differ from those dropped",
    );
  });

  it("a text comes back as before: a string, not an object; the channel did not change shape", async () => {
    const write = await app.request(`/internal/sessions/${SESSION}/fs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        op: "write",
        path: `/artifacts/${LIVE_TASK}/attachments/notes.md`,
        content: "# read me\n",
      }),
    });
    assert.equal(write.status, 200);
    const read = await readAsContainer(`/artifacts/${LIVE_TASK}/attachments/notes.md`);
    const body = (await read.json()) as { result: unknown };
    assert.equal(body.result, "# read me\n");
  });

  it("without a session token, reading stays closed", async () => {
    const res = await app.request(`/internal/sessions/${SESSION}/fs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "read", path: `/artifacts/${LIVE_TASK}/attachments/notes.md` }),
    });
    assert.equal(res.status, 401);
  });
});

describe("removal", () => {
  it("the operator removes what they attached; an unknown name returns 404", async () => {
    assert.equal(
      (await app.request(`/api/tasks/${TASK}/attachments/missing.png`, { method: "DELETE" }))
        .status,
      404,
    );
    const del = await app.request(`/api/tasks/${TASK}/attachments/Capture-d-ecran-2026-09-02.png`, {
      method: "DELETE",
    });
    assert.equal(del.status, 200);
    assert.deepEqual(await (await app.request(`/api/tasks/${TASK}/attachments`)).json(), []);
  });

  it("a live session freezes removal: the agent got the path, the file does not vanish underneath", async () => {
    const res = await app.request(`/api/tasks/${LIVE_TASK}/attachments/capture.png`, {
      method: "DELETE",
    });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /does not get pulled out/);
  });
});
