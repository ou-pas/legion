// A task's files (06/09): what the agent delivered, what the operator attached.
//
// Six routes deliberately mirrored in pairs: same run folder, same transport, same serving headers.
// What changes is one word, the direction: an artifact comes up from the agent, an attachment goes
// down from the operator, and the screen must be able to tell which one it shows.
//
// None of these routes talks to the database: `taskArtifactsDir` returns the folder and the task,
// and its `null` is the 404. Deliberate exception since 07/09: dropping an attachment checks whether
// a session is listening, to tell it about the file (`notifyLiveSession`).
import type { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { parseBody } from "../../http/parse-body.js";
import { artifactKind, artifactMimeType } from "../artifacts/mime.js";
import { artifactsPath } from "../artifacts/scope.js";
import { taskArtifactsDir } from "../artifacts/dir.js";
import {
  attachmentFile,
  listAttachments,
  removeAttachment,
  saveAttachment,
  type Attachment,
} from "../attachments.js";
import { taskLiveSessions } from "../../projects/purge.js";
import { steerRefusal } from "../../sessions/steering.js";
import { notifyAttachment } from "../attachment-notify.js";
import { attachmentBody } from "../schemas.js";

/** Only removal stays frozen by a live session (07/09). Dropping no longer is: a file added during
 *  the session is announced to it (`notifyLiveSession`) and makes no instruction lie. A removed file
 *  does: the session was given its path (in the brief or by a steer) and may be reading it; pulling
 *  it out turns an instruction into an unexplained 422. Between sessions, remove then rerun is the
 *  normal gesture. */
function removalLocked(
  taskId: string,
): { error: string; live: { id: string; status: string }[] } | null {
  const live = taskLiveSessions(taskId);
  const [first] = live;
  if (!first) return null;
  return {
    error: `session ${first.status} in flight: it was handed this file's path, it does not get pulled out from under it`,
    live,
  };
}

/** What the drop response says about what follows: the running session was told, or nobody was and
 *  why. Never a failure: the file is stored, and the next session finds it named in its brief
 *  (`briefAttachmentsSection`) whatever happens here. */
type AttachmentNotice =
  | { notified: "steered"; sessionId: string }
  | { notified: "none"; reason: string };

/** Tells the live session about the file, if it is listening. `steerRefusal` decides: `waiting`,
 *  `blocked` and `committing` have no runtime left to receive a message, and a steer queued for a
 *  destroyed runtime would be silently swallowed, exactly what this module refuses. One session per
 *  task in practice; if there were several, the first is enough, the file is in the run's shared
 *  folder. */
function notifyLiveSession(taskId: string, attachment: Attachment): AttachmentNotice {
  const [live] = taskLiveSessions(taskId);
  if (!live)
    return {
      notified: "none",
      reason: "no session in flight: the next one will read the file in its brief",
    };
  const refusal = steerRefusal(live.status);
  if (refusal) return { notified: "none", reason: refusal.error };
  // Held a second and a half and grouped: three files dropped in a row make one message.
  notifyAttachment(live.id, attachment);
  return { notified: "steered", sessionId: live.id };
}

/** Serves a file from the run folder. A non-image binary is downloaded, never rendered inline: the
 *  content-type already says `application/octet-stream` for anything unrecognised, and the
 *  attachment disposition removes any temptation for the browser to guess another (a .html renamed
 *  to .bin must never end up interpreted).
 *
 *  CSP sandbox on every file (review P3 #2): agent-written content (html, svg…) browsed same-origin
 *  must never drive the unauthenticated API; an svg with a `<script>` could otherwise approve its
 *  own gate. An attachment is confined the same way: it comes from the operator, but an .svg
 *  downloaded elsewhere carries someone else's script. */
function serveFile(
  c: { header: (n: string, v: string) => void; body: (b: Buffer) => Response },
  file: string,
): Response {
  const name = path.basename(file);
  c.header("content-type", artifactMimeType(name));
  if (artifactKind(name) === "binary")
    c.header("content-disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
  c.header("content-security-policy", "sandbox allow-scripts");
  return c.body(fs.readFileSync(file));
}

export function registerTaskArtifactRoutes(app: Hono): void {
  app.get("/api/tasks/:id/artifacts", (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    if (!fs.existsSync(ctx.dir)) return c.json([]);
    // `mimeType`/`kind`: the list tells text from binary by extension (see artifacts/mime.ts). The
    // screen picks its rendering (iframe, <img>, download) from `kind`, never by guessing from the
    // name.
    return c.json(
      fs
        .readdirSync(ctx.dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => ({
          name: e.name,
          size: fs.statSync(path.join(ctx.dir, e.name)).size,
          mimeType: artifactMimeType(e.name),
          kind: artifactKind(e.name),
        })),
    );
  });

  app.get("/api/tasks/:id/artifacts/:name", (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    const file = path.join(ctx.dir, path.basename(c.req.param("name"))); // no traversal
    if (!fs.existsSync(file)) return c.json({ error: "artifact not found" }, 404);
    return serveFile(c, file);
  });

  app.get("/api/tasks/:id/attachments", (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    return c.json(listAttachments(ctx.dir, artifactsPath(ctx.task)));
  });

  app.post("/api/tasks/:id/attachments", async (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    const body = await parseBody(c, attachmentBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const saved = saveAttachment(
      ctx.dir,
      artifactsPath(ctx.task),
      body.value.name,
      body.value.contentBase64,
    );
    // 422, not 400: the body is well formed, the file is refused (too big, empty, unnamed). Same
    // code as the binary channel refusal on /internal, and the message names the cap rather than
    // leaving it to guess.
    if (!saved.ok) return c.json({ error: saved.reason }, 422);
    const notice = notifyLiveSession(ctx.task.id, saved.attachment);
    return c.json({ attachment: saved.attachment, replaced: saved.replaced, ...notice }, 201);
  });

  app.delete("/api/tasks/:id/attachments/:name", (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    const locked = removalLocked(ctx.task.id);
    if (locked) return c.json(locked, 409);
    if (!removeAttachment(ctx.dir, c.req.param("name")).ok)
      return c.json({ error: "attachment not found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/tasks/:id/attachments/:name", (c) => {
    const ctx = taskArtifactsDir(c.req.param("id"));
    if (!ctx) return c.json({ error: "task not found" }, 404);
    const file = attachmentFile(ctx.dir, c.req.param("name"));
    if (!file) return c.json({ error: "attachment not found" }, 404);
    return serveFile(c, file);
  });
}
