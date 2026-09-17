import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { answerInbox, listOpenInbox, listNotices, markNoticeRead } from "../inbox/inbox.js";
import { saveInboxDraft } from "./inbox-draft.js";
import { listTaskInboxHistory } from "./inbox-history.js";
import { inboxQuestion } from "./inbox-question.js";
import { pendingByProject } from "./pending-by-project.js";

/** A human answer: a choice, free text, or a filled form. `formData` stays `unknown` because the
 *  agent declares its shape case by case; `answerInbox` checks it and names the bad field. */
const inboxReplyBody = z.strictObject({
  choiceId: z.string().optional(),
  text: z.string().optional(),
  formData: z.unknown().optional(),
});

/** A round draft. Values are declared by the agent, so `validateFormDraft` (inbox-draft.ts) checks
 *  them. This is only the envelope; `strictObject` makes a screen sending `answer` instead of
 *  `formData` get the key named rather than a silently empty draft. */
const inboxDraftBody = z.strictObject({ formData: z.unknown() });

export function registerInboxRoutes(app: Hono): void {
  app.get("/api/inbox", (c) => c.json(listOpenInbox()));

  // What is stopped, per project: the icon rail badge (slice nav/02). Separate from
  // `/api/bootstrap` because it changes by the minute.
  app.get("/api/inbox/pending-by-project", (c) => c.json(pendingByProject()));

  // Full inbox history of one task (closed questions included), across sessions, for the channel
  // view and the interview tab. /api/inbox stays the open-only queue. Contract in task
  // HSV_FFG00R's artifact.
  app.get("/api/tasks/:id/inbox-history", (c) => c.json(listTaskInboxHistory(c.req.param("id"))));

  // One question, for its dedicated page (07/09). Must stay after `pending-by-project`: Hono tries
  // routes in declaration order, and `:id` would swallow it. 404 on an unknown id: an old pasted
  // link is not a failure.
  app.get("/api/inbox/:id", (c) => {
    const question = inboxQuestion(c.req.param("id"));
    return question ? c.json(question) : c.json({ error: "unknown question" }, 404);
  });

  // The draft (07/09): decided, not yet sent. `PATCH` because it modifies an entry without
  // accomplishing anything; answering is `reply`. 409, not 400, when the question is no longer
  // open: a state conflict, which the screen uses to switch to read-only.
  app.patch("/api/inbox/:id/draft", async (c) => {
    const parsed = await parseBody(c, inboxDraftBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      return c.json({ ok: true, ...saveInboxDraft(c.req.param("id"), parsed.value.formData) });
    } catch (err) {
      const message = String((err as Error).message);
      if (message === "inbox message not found") return c.json({ error: "unknown question" }, 404);
      if (message === "the question is no longer open") return c.json({ error: message }, 409);
      return c.json({ error: message }, 400);
    }
  });

  // In-app notices (v14): standup and information not tied to a session.
  app.get("/api/notices", (c) => c.json(listNotices()));
  app.post("/api/notices/:id/read", (c) => {
    markNoticeRead(c.req.param("id"));
    return c.json({ ok: true });
  });

  // `answerInbox` refuses by throwing a bare `Error` (closed question, unknown choice, missing
  // form field) whose sentence is shown as-is in a toast.
  app.post("/api/inbox/:id/reply", async (c) => {
    const parsed = await parseBody(c, inboxReplyBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const answer = await answerInbox(c.req.param("id"), parsed.value);
      return c.json({ ok: true, answer });
    } catch (err) {
      return c.json({ error: String((err as Error).message) }, 400);
    }
  });
}
