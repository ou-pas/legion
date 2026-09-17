// The /internal API: THE session runtime port (spec, events, fs, inbox, propose, wait, steer,
// task). authSession lives here: it is the container → control plane contract.
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, logControlEvent, schema } from "../shared/db.js";
import { ackOf, publish, publishSeq } from "../shared/events.js";
import {
  authorize,
  fsExec,
  projectRoot,
  resolveAgentPath,
  type FsGrant,
} from "../projects/fs-acl.js";
import { addNotice, createInboxMessage } from "../inbox/inbox.js";
import { INBOX_KIND } from "../inbox/inbox-enums.js";
import { type FormSpec, validateFormSpec } from "../inbox/inbox-form.js";
import { parseBody } from "../http/parse-body.js";
import {
  eventBody,
  fsBody,
  inboxBody,
  proposeTaskBody,
  steerBody,
  taskPatchBody,
  waitForTaskBody,
} from "./internal-schemas.js";
import { missingArtifacts, onTaskDone, settleDone } from "../chains/templates.js";
import { agentStatusRefusal, inertReviewRequest } from "./agent-task-gate.js";
import { artifactsPath, sessionArtifactGrants } from "../tasks/artifacts/scope.js";
import { artifactKind, artifactMimeType } from "../tasks/artifacts/mime.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { STEER_HOLD_MS, waitForSteers } from "../sessions/steering.js";
import { isPauseRequested } from "./operator-pause.js";
import { PROPOSAL_CAP_PER_SESSION, proposeTask } from "../tasks/task-propose.js";
import { requestWaitForTask } from "../sessions/wait-for-task.js";
import { takeSpec } from "../sessions/runner/boot.js";
import { noteTurnWall } from "./turn-wall.js";
import { runCostOf, sessionCostAfter, taskCostAfter } from "./session-cost.js";
import { applyTaskTransition, decidedMove, TASK_MOVE, TASK_STATUS } from "../tasks/lifecycle.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";

/** The container → control plane contract: the session whose id is in the URL, if the token carries
 *  its `callbackToken`. At module level (09/09) so a route in another file of the domain
 *  (`request-repo.ts`) can use it without this file growing further: it is already the repository's
 *  longest function, and the harness refuses to let it grow. */
export function authSession(c: {
  req: { header: (n: string) => string | undefined; param: (n: string) => string };
}) {
  const token = c.req.header("authorization")?.replace(/^Bearer /, "");
  const session = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, c.req.param("id")))
    .get();
  if (!session || !token || token !== session.callbackToken) return null;
  return session;
}

/** The `sdkSessionId` reported by the runtime, if safe.
 *
 *  It comes from the container (so potentially from a compromised agent) and ends up in a copyable
 *  shell command (`resume-command.ts`): accept ONLY safe UUIDs/ids, never shell metacharacters
 *  (review lot2 #1, critical). A refused format is not silent: it enters the session trace. */
function rememberSdkSessionId(sessionId: string, payload: unknown): void {
  const reported = (payload as { sdkSessionId?: string } | null)?.sdkSessionId;
  if (!reported) return;
  const sid = String(reported);
  if (!SAFE_SDK_SESSION_ID.test(sid)) {
    publish(sessionId, "run_warning", { message: "sdkSessionId ignored (invalid format)" });
    return;
  }
  db.update(schema.sessions)
    .set({ sdkSessionId: sid })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

const SAFE_SDK_SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A failed git push = work at risk → outbound notification (v11) AND a log line. Spread BEFORE
 *  `sessionId`: the agent cannot overwrite `sessionId` through its payload (review lot2 #9). */
function announcePushFailure(sessionId: string, payload: unknown): void {
  notifyOut(NOTIF_EVENT.repoPushFailed, { ...(payload as Record<string, unknown>), sessionId });
  logControlEvent("error", "integration", `git push failed (session ${sessionId})`, {
    sessionId,
    ...(payload as Record<string, unknown>),
  });
}

export function registerInternalRoutes(app: Hono): void {
  // Internal API (session runtimes).
  // Boot: the container fetches its spec with a single-use nonce instead of receiving it as an
  // environment variable (where `docker inspect` read the auth token, granted secrets and resolved
  // MCP headers; see runner/boot.ts). No `authSession` here: the callback token IS in the served
  // spec, the nonce is what counts.
  app.get("/internal/sessions/:id/spec", (c) => {
    const spec = takeSpec(c.req.param("id"), c.req.header("x-legion-boot") ?? "");
    if (spec === null)
      return c.json({ error: "bootstrap unknown, stale or already consumed" }, 410);
    return c.json(spec);
  });

  app.post("/internal/sessions/:id/events", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    // Body validated at the boundary (05/09, see internal-schemas.ts): the schema holds the contract
    // the `<T>` of `c.req.json` only declared.
    const parsed = await parseBody(c, eventBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { type, payload } = parsed.value;
    // v36: the runtime's number. Absent (pre-v36 payload, or a client that does not number): one is
    // assigned next in line, so EVERY row from here carries one. Present: the runtime decides, and
    // re-sending the same one is free.
    const seq = parsed.value.seq ?? ackOf(session.id) + 1;
    // The three costs (run, session, task) are computed in `session-cost.ts`; this route only reads
    // rows and writes the result.
    const runCost = runCostOf(type, payload);
    const sessionCostUsd = runCost === null ? null : sessionCostAfter(session.costUsd, runCost);
    let eventPayload: unknown = payload ?? {};
    if (sessionCostUsd !== null)
      eventPayload = {
        ...(payload as Record<string, unknown>),
        taskCostUsd: taskCostAfter(
          db.select().from(schema.sessions).where(eq(schema.sessions.taskId, session.taskId)).all(),
          session.id,
          sessionCostUsd,
        ),
      };
    // A DUPLICATE stops here: the row exists, was already broadcast, and above all its side effects
    // already happened. Re-notifying a failed push because the runtime re-sent its frame would be
    // worse than losing the event; this boolean protects against that.
    if (!publishSeq(session.id, seq, type, eventPayload))
      return c.json({ ok: true, ack: ackOf(session.id), duplicate: true });
    // The cost write comes AFTER this guard, not before as until 10/09. While it was an overwrite, a
    // re-sent frame rewrote the same value; since it is an addition, it would add it twice.
    if (sessionCostUsd !== null)
      db.update(schema.sessions)
        .set({ costUsd: sessionCostUsd })
        .where(eq(schema.sessions.id, session.id))
        .run();
    if (type === "init") rememberSdkSessionId(session.id, payload);
    // A `throttle` is only kept in the trace: the window map once kept here was only read by the plan
    // gauge, removed on 30/08. The persisted event is what the out-of-quota pause (`quota-pause.ts`)
    // reads the reset time from.
    // The hard turn wall should no longer be reached since the automatic relaunch (10/09): seeing it
    // means one of the two paths failed. The filter is in `turn-wall.ts`; this route does not know
    // what a `result` subtype means.
    if (type === "result") noteTurnWall(session, eventPayload);
    if (type === "repo_push_failed") announcePushFailure(session.id, payload);
    // The ACK. The runtime rereads it to know how far the server heard it, which lets it drain its
    // queue without guessing, and replay it when it guessed wrong.
    return c.json({ ok: true, ack: seq });
  });

  app.post("/internal/sessions/:id/fs", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    // `contentBase64` (slice "artifacts accept binary", 02/09): the second write path, decoded to raw
    // bytes by `fsExec` (see its comment for why `content` alone could not carry binary).
    const parsed = await parseBody(c, fsBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { op, path: rawPath, content, contentBase64 } = parsed.value;
    const agent = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, session.agentId))
      .get();
    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, session.taskId)).get();
    const project = task
      ? db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get()
      : undefined;
    if (!agent || !task || !project) return c.json({ error: "context not found" }, 404);
    // Session folders: the agent's, plus its artifacts folder read-write and its FAMILY's read-only
    // (lot 73, see tasks/artifacts/scope.ts). A task proposed by another is sent to read its origin's
    // contract: without this second set it got the path in its brief and a refusal on opening.
    const grants: FsGrant[] = [
      ...(JSON.parse(agent.fsGrants) as FsGrant[]),
      ...sessionArtifactGrants(task),
    ];
    // A relative path ("pr.md") goes to the session's WORKING folder, its artifacts, NEVER "the first
    // writable folder": that rule designated the agent's personal folder, and a relative pr.md
    // silently vanished there (bug of 23/08, see resolveAgentPath in fs-acl.ts). The personal folder
    // stays reachable with an absolute path.
    const effectivePath = resolveAgentPath(rawPath, artifactsPath(task));
    const auth = authorize(grants, op, effectivePath);
    if (!auth.ok) {
      // Tell the agent WHICH folders it has — an opaque denial burns turns for nothing.
      const granted = grants.map((g) => g.folderPath).join(", ") || "none";
      publish(session.id, "fs_denied", { op, path: rawPath, reason: auth.reason });
      return c.json({ error: `${auth.reason} — your granted folders: ${granted}` }, 403);
    }
    // Reading an image returns the image (slice "the brief carries attachments", 02/09), and the
    // ROUTE decides, not the container: a file's type is a domain fact (`artifactKind`, by
    // extension), not a caller option. So the channel exposes no "base64" switch: `fs_read` on a
    // `.png` attachment returns bytes and their MIME type, on a `.md` the usual string. Without it,
    // an image attachment reread by the agent came back as corrupted utf8, i.e. nothing.
    const wantsBytes = op === "read" && artifactKind(auth.clean) === "image";
    const res = fsExec(projectRoot(project.slug, project.fsRoot), op, auth.clean, {
      content,
      contentBase64,
      ...(wantsBytes ? { base64: true } : {}),
    });
    if (!res.ok) return c.json({ error: res.reason }, 422);
    publish(session.id, "fs_op", { op, path: auth.clean });
    const result =
      wantsBytes && res.result && typeof res.result === "object"
        ? { ...(res.result as object), mimeType: artifactMimeType(auth.clean) }
        : res.result;
    return c.json({ ok: true, result });
  });

  // Inbox: a blocking question flips the session to waiting; the runtime then
  // exits and is destroyed. The human answer (web/Discord) respawns it with `resume`.
  app.post("/internal/sessions/:id/inbox", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const agent = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, session.agentId))
      .get();
    if (!agent?.inboxAccess) return c.json({ error: "inbox not granted to this agent" }, 403);
    // The body is judged BEFORE being read (05/09). `c.req.json<T>()` declared a shape without
    // checking it, and `{ ...body }` passed into `createInboxMessage` everything the agent set,
    // including `reason`, `wakeAt` and `waitForTaskId`, three fields the service reads and no agent
    // may set: an agent-posted `reason: "operator-pause"` was enough for the human NOT to be
    // notified. An unknown key is REFUSED by name rather than ignored, so the agent learns what it
    // does not get to decide.
    const parsed = await parseBody(c, inboxBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    // v31, form: validated HERE, at the agent → control plane boundary. A refusal is NAMED and
    // returned as 400: the agent reads the reason in the tool result and fixes its spec, cheaper than
    // a badly asked question costing a pause/resume cycle.
    let form: FormSpec | undefined;
    if (body.form !== undefined) {
      try {
        form = validateFormSpec(body.form);
      } catch (err) {
        return c.json({ error: String((err as Error).message) }, 400);
      }
    }
    // Field by field, never a spread: what the service receives is readable here, in full.
    const created = createInboxMessage(session.id, {
      kind: form ? INBOX_KIND.form : body.kind,
      body: body.body,
      choices: body.choices,
      form,
      informational: body.informational,
      evidence: body.evidence,
      impact: body.impact,
      /** Slice nav/11: the agent asks for the RIGHT to do something, not information. The session
       *  goes `blocked` and no automation writes into it anymore. */
      approval: body.approval,
    });
    return c.json({ ok: true, inboxId: created.id }, 201);
  });

  // Inbox extension (23/08): an agent discovering work outside its scope FILES it instead of losing
  // it in its report. task-propose.ts holds the three non-negotiable guardrails (later / never
  // assigned / cap per session), enforced server-side, never in an agent prompt. Same gate as the
  // inbox (agent.inboxAccess): the same capability family, talking to the human. The SDK already
  // filters the tool on the same flag (runner/spec.ts, allowedTools); this check is belt and braces.
  app.post("/internal/sessions/:id/propose-task", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const agent = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, session.agentId))
      .get();
    if (!agent?.inboxAccess) return c.json({ error: "inbox not granted to this agent" }, 403);
    const parsed = await parseBody(c, proposeTaskBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    const res = proposeTask(session.id, {
      name: body.name,
      brief: body.brief,
      complexity: body.complexity,
      agentName: body.agentName,
      blocking: body.blocking,
      blockerIds: body.blockerIds,
      criteria: body.criteria,
    });
    // A cap refusal SHOWS (09/09). The other refusals are shape errors the agent fixes alone (name
    // too long, unknown blocker); this one cannot be fixed, it STOPS a breakdown midway. On 09/09 it
    // cut a seven-batch plan after the fifth, and the only trace was a line in an artifact nobody had
    // to read. Work shifted to the human must tell the human.
    if (!res.ok) {
      if (res.status === 429)
        addNotice(
          `${agent.name} could NOT propose “${body.name}”: the cap of ${PROPOSAL_CAP_PER_SESSION} ` +
            "proposals per session is reached. What it wanted to propose is lost for the board — " +
            "its report or its plan says what is missing, to be created by hand.",
          "task_proposed",
        );
      return c.json({ error: res.error }, res.status);
    }
    publish(session.id, "task_proposed", { taskId: res.task.id, name: res.task.name });
    // In-app notice (v14): WITHOUT it a proposal sleeps until a human stumbles on it in the later
    // column, exactly the problem this module fixes. "Proposed" in the sense of filed (24/08): the
    // task EXISTS on the board; only the AGENT remains a suggestion. A PREREQUISITE does not read as
    // an extra: the notice says so plainly, because it is the difference between "there will be
    // work" and "what I just delivered is not usable without it".
    const originName =
      db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, res.task.proposedFromTaskId ?? ""))
        .get()?.name ?? "?";
    addNotice(
      res.blocked
        ? `${agent.name} proposed a PREREQUISITE of “${originName}”: “${res.task.name}”` +
            (res.task.proposedAgentName
              ? ` (suggested agent: ${res.task.proposedAgentName})`
              : "") +
            " — the original task is marked blocked by it, and it sleeps in Later."
        : `${agent.name} proposed a task in Later: “${res.task.name}”` +
            (res.task.proposedAgentName
              ? ` (suggested agent: ${res.task.proposedAgentName})`
              : "") +
            ` — from task “${originName}”.`,
      "task_proposed",
    );
    notifyOut(NOTIF_EVENT.taskProposed, {
      taskId: res.task.id,
      name: res.task.name,
      agentName: agent.name,
      sessionId: session.id,
    });
    // The warning (unknown agent suggestion) goes back to the AGENT in its tool result: the only place
    // it can learn not to do it again.
    return c.json(
      res.warning
        ? { ok: true, taskId: res.task.id, blocked: res.blocked, warning: res.warning }
        : { ok: true, taskId: res.task.id, blocked: res.blocked },
      201,
    );
  });

  // `wait_for_task` (v26): the session SLEEPS on a dependency and wakes on its own when the target
  // task goes `done` (wait-for-task.ts holds the guardrails: cycle refused, target already done →
  // immediate answer, one wait per session, project boundary). Same gate as the inbox: the tool
  // CREATES an inbox entry and pauses the session, so an agent without inbox must not be able to
  // fall asleep, since nobody could wake it by hand.
  app.post("/internal/sessions/:id/wait-for-task", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const agent = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, session.agentId))
      .get();
    if (!agent?.inboxAccess) return c.json({ error: "inbox not granted to this agent" }, 403);
    const parsed = await parseBody(c, waitForTaskBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const res = requestWaitForTask(session.id, {
      taskId: parsed.value.taskId,
      note: parsed.value.note,
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    if (!res.waiting) return c.json({ ok: true, waiting: false, result: res.result });
    return c.json({ ok: true, waiting: true, inboxId: res.inboxId, target: res.target }, 201);
  });

  // Steering, runtime side: the container FETCHES the messages the human pushed, on the callback
  // channel it already uses (same token, same port; no inbound channel to the runtime is opened,
  // the invariant kept). The request is held up to STEER_HOLD_MS so injection is near real time
  // without tight polling.
  //
  // `listening: false` = the session can no longer receive: the runtime stops calling back instead
  // of holding a request against a dead one. `starting` and `committing` keep listening, the first
  // because the row may lag a millisecond behind a container that already runs.
  app.post("/internal/sessions/:id/steer", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (!["starting", "running", "committing"].includes(session.status))
      return c.json({ ok: true, listening: false, messages: [] });
    // Same boundary as the other bodies (05/09): an unreadable body or unknown key is a named 400,
    // no longer a silent `{}`. The runtime always sends `{ waitMs }`.
    const parsed = await parseBody(c, steerBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const hold = Math.min(parsed.value.waitMs ?? STEER_HOLD_MS, STEER_HOLD_MS);
    // The pause flag travels on THIS channel: the one the runtime already polls, with the same token
    // and URL. A second channel for a boolean would be one more port to secure for nothing.
    const messages = await waitForSteers(session.id, hold);
    return c.json({ ok: true, listening: true, messages, pause: isPauseRequested(session.id) });
  });

  // The Legion MCP calls back here. Approval gates are enforced HERE, not in prompts:
  // an agent token can never set a gated task to done (plan.md invariant).
  app.patch("/internal/sessions/:id/task", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const parsed = await parseBody(c, taskPatchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { status, note } = parsed.value;
    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, session.taskId)).get();
    if (!task) return c.json({ error: "task not found" }, 404);

    // The gates live in `agent-task-gate.ts`, with their test: this route APPLIES them.
    const refusal = agentStatusRefusal(task, status);
    if (refusal) return c.json({ error: refusal }, 403);

    if (status && !inertReviewRequest(task, status)) {
      // Artifact contract: a step without its expected artifacts cannot be done (plan.md §4).
      if (status === TASK_STATUS.done) {
        const missing = missingArtifacts(task.id);
        if (missing.length > 0) {
          applyTaskTransition(task.id, TASK_MOVE.artifactsMissing);
          publish(session.id, "task_status", {
            status: TASK_STATUS.review,
            missingArtifacts: missing,
          });
          return c.json(
            { error: `missing expected artifacts: ${missing.join(", ")} — task left in review` },
            422,
          );
        }
      }
      const wasDone = task.status === TASK_STATUS.done;
      // Only on the TRANSITION to done (review lot2 #12): an agent calling done in a loop does not
      // retrigger the chain or the context enrichment (otherwise unbounded haiku calls).
      const finishing = status === TASK_STATUS.done && !wasDone;
      // Consuming blocker links joins the status update in ONE transaction (`settleDone`,
      // chains/templates.ts); follow-ups run after, outside it.
      const released = db.transaction(() => {
        applyTaskTransition(task.id, decidedMove(status)); // target announced by the agent, guards above
        return finishing ? settleDone(task.id) : [];
      });
      publish(session.id, "task_status", { status });
      if (finishing) onTaskDone(task.id, released, note);
      // A gate waiting for the human = notification (the agent finished, your turn)
      if (status === TASK_STATUS.review && task.approvalGate)
        notifyOut(NOTIF_EVENT.gateWaiting, {
          taskId: task.id,
          task: task.name,
          note: note?.slice(0, 200),
        });
    }
    if (note) {
      db.insert(schema.taskActivity)
        .values({
          id: nanoid(10),
          taskId: task.id,
          from: ACTIVITY_FROM.agent,
          body: note,
          createdAt: new Date(),
        })
        .run();
      publish(session.id, "activity", { note });
    }
    return c.json({ ok: true });
  });
}
