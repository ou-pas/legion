// `request_repo` (09/09): an agent ASKS for a project repository it was not granted, and the human's
// answer really grants it.
//
// The gap. Task ZsbmD_N-zS: the agent had one repository, the spec said the whole diff lived in
// another. It asked an inbox question with a "grant, same session" choice of its own invention; the
// operator picked it; nothing on the server honoured it. At wake-up the agent ran `git clone`
// itself, made two commits, and `pushRepos` (which only knows the spec) pushed the granted
// repository with zero changes. A clean `review`, no PR, and the volume swept with the commits.
//
// Nothing reinvented: the question is an ordinary inbox entry, an approval (the session goes
// `blocked`, only a human answers), with two choices. The only addition is the `grantRepoName`
// field (v68) `answerInbox` reads: granting puts the repository on the agent record BEFORE the
// resume, and the resume (which rereads the record and clones what is missing) does the rest.
//
// Refusals are named at request time, not three turns later:
//  · repository unknown to the project → 404 with the project's repositories;
//  · agent without repository access → 409;
//  · repository already granted → 409 (already cloned, the agent looks in the wrong place);
//  · a request already open for this session → 409;
//  · session with no turn left to play → 409.
import type { Hono } from "hono";
import { logControlEvent } from "../events/control-log-store.js";
import {
  agentRow,
  openGrantRequestOf,
  repoNamesOfProject,
  sessionRow,
  taskRow,
} from "./request-repo-store.js";
import { createInboxMessage } from "../inbox/inbox.js";
import { INBOX_KIND } from "../inbox/inbox-enums.js";
import { REPO_ACCESS } from "../shared/enums.js";
import { parseBody } from "../http/parse-body.js";
import { authSession } from "./internal-routes.js";
import { requestRepoBody } from "./internal-schemas.js";
import { GRANT_CHOICE, repoOfProject } from "./repo-grant.js";

/** Bounded: the reason comes from an agent and shows in the attention queue (the entry's `evidence`,
 *  which `createInboxMessage` cuts at 1,200 anyway). */
const WHY_MAX = 1200;

/** States in which a session can still ask a question and pause. */
const PAUSABLE = ["starting", "running"] as const;

export type RequestRepoResult =
  | { ok: true; inboxId: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

export function requestRepoGrant(
  sessionId: string,
  input: { repo: string; why: string },
): RequestRepoResult {
  const session = sessionRow(sessionId);
  if (!session) return { ok: false, status: 404, error: "session not found" };
  const task = taskRow(session.taskId);
  const agent = agentRow(session.agentId);
  if (!task || !agent) return { ok: false, status: 404, error: "task or agent not found" };

  const name = input.repo.trim();
  if (!name) return { ok: false, status: 400, error: "empty repo" };
  if (!repoOfProject(task.projectId, name)) {
    // Sorted: the message is read by a model about to fix its call, and by a test.
    const known = repoNamesOfProject(task.projectId).sort();
    return {
      ok: false,
      status: 404,
      error: `repo “${name}” unknown in this project — repos of the project: ${known.join(", ") || "none"}`,
    };
  }
  if (agent.repoAccess === REPO_ACCESS.none)
    return {
      ok: false,
      status: 409,
      error: "this agent has no repo access: nothing can be granted to it",
    };
  if ((JSON.parse(agent.repoNames) as string[]).includes(name))
    return {
      ok: false,
      status: 409,
      error: `“${name}” is already granted: it is cloned into repos/${name} of your workspace`,
    };

  const pending = openGrantRequestOf(sessionId);
  if (pending)
    return {
      ok: false,
      status: 409,
      error: `a repo request (“${pending.grantRepoName}”) is already pending for this session`,
    };
  if (!(PAUSABLE as readonly string[]).includes(session.status))
    return {
      ok: false,
      status: 409,
      error: `session “${session.status}”: it is no longer in a state to start waiting`,
    };

  const created = createInboxMessage(sessionId, {
    kind: INBOX_KIND.choice,
    body:
      `${agent.name} asks for access to repo “${name}” for task “${task.name}”.\n\n` +
      `Granting adds it to its record: the repo is cloned on resume, on the task branch, ` +
      `and pushed like the others.`,
    choices: [
      { id: GRANT_CHOICE.grant, label: `Grant “${name}” to ${agent.name}` },
      { id: GRANT_CHOICE.refuse, label: "Refuse" },
    ],
    evidence: input.why.trim().slice(0, WHY_MAX),
    // The impact is the GRANT's, not the task's: the agent record applies to everything it does
    // next. Saying it here lets the operator decide from the list.
    impact:
      `Granted: ${agent.name} will read and write “${name}” for all its future tasks, not just this one. ` +
      `Refused: it does without, or stops and explains why.`,
    approval: true,
    grantRepoName: name,
  });
  logControlEvent("info", "repo-grant", `session ${sessionId} asks for repo ${name}`, {
    sessionId,
    taskId: task.id,
    agentId: agent.id,
    repo: name,
    inboxId: created.id,
  });
  return { ok: true, inboxId: created.id };
}

/** The `/internal` port route, HERE and not in `internal-routes.ts`: `registerInternalRoutes` is
 *  already the repository's longest function and the harness refuses to let it grow. Same contract
 *  as the port's other routes (session token, `inboxAccess`: it is a question to the human, so the
 *  same gate as the inbox). */
export function registerRequestRepoRoute(app: Hono): void {
  app.post("/internal/sessions/:id/request-repo", async (c) => {
    const session = authSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const agent = agentRow(session.agentId);
    if (!agent?.inboxAccess) return c.json({ error: "inbox not granted to this agent" }, 403);
    const parsed = await parseBody(c, requestRepoBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const res = requestRepoGrant(session.id, { repo: parsed.value.repo, why: parsed.value.why });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true, inboxId: res.inboxId }, 201);
  });
}
