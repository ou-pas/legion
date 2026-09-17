// What sets a task moving (06/09): the launch, and the message that reruns.
//
// The operator's two gestures that start a session. They share the capacity policy: at full
// capacity, queue rather than fail (v13); a refusal would force the screen to retry, and the queue
// exists precisely for that.
import type { Hono } from "hono";
import { parseBody } from "../../http/parse-body.js";
import { RUN_QUEUED, runTask } from "../../sessions/runner/manager.js";
import { imageWaitOfTask } from "../../sessions/runner/image-wait.js";
import { answerImageRebuild } from "../../sessions/runner/image-watch.js";
import { sendTaskMessage } from "../task-message.js";
import { taskMessageBody } from "../schemas.js";

export function registerTaskRunRoutes(app: Hono): void {
  app.post("/api/tasks/:id/run", async (c) => {
    try {
      const sessionId = await runTask(c.req.param("id"), {
        mock: c.req.query("mock") === "1" ? true : undefined,
        enqueueOnFull: true,
      });
      if (sessionId === RUN_QUEUED) return c.json({ queued: true }, 202);
      return c.json({ sessionId }, 202);
    } catch (err) {
      // 400 for any launch fault, `NoCapacityError` included (it cannot happen here, `enqueueOnFull`,
      // but stays in the net), like a missing task, an agent without a runner or an unreachable
      // repository. The service message carries the distinction, the status does not, and that
      // shipped behaviour is kept as is.
      return c.json({ error: String((err as Error).message) }, 400);
    }
  });

  // Rebuild the image holding this task (12/09).
  //
  // The same gesture as the inbox's "Rebuild" answer, reachable from the task page where the cause
  // is already written next to the verdict. Separate from infra's `rebuild-image`, which needs a
  // machine and an image, exactly what the screen must not have to deduce. Here the task is enough:
  // the server knows which image holds it and which rebuild (fleet or project) applies.
  //
  // 409 when nothing waits any more: the wait may have lifted between display and click (the probe
  // saw the image come back). Saying "nothing left to rebuild" beats rebuilding a present image.
  app.post("/api/tasks/:id/rebuild-image", async (c) => {
    const wait = imageWaitOfTask(c.req.param("id"));
    if (!wait)
      return c.json({ error: "this task is not waiting on any image: nothing to rebuild" }, 409);
    await answerImageRebuild(
      {
        runnerId: wait.runnerId,
        runnerName: wait.runnerName,
        image: wait.image,
        projectId: wait.projectId,
      },
      "rebuild",
    );
    return c.json({ image: wait.image, runnerName: wait.runnerName }, 202);
  });

  // Talking to a task without a live session (03/09). Steering talks to the running runtime and
  // rightly refuses elsewhere, since there is nobody to pass it to. This gesture amends the brief
  // and reruns: the message is read when the next session starts.
  //
  // Separate from `PATCH /api/tasks/:id`, which replaces a description without launching anything.
  // Merging them would force every caller to know whether it corrects an instruction or adds one,
  // and to rebuild the brief itself, hence to know the marker.
  app.post("/api/tasks/:id/message", async (c) => {
    const body = await parseBody(c, taskMessageBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const sent = await sendTaskMessage(c.req.param("id"), body.value.text);
    if (!sent.ok) return c.json({ error: sent.error }, sent.status);
    return c.json({ ok: true, sessionId: sent.sessionId, queued: sent.queued }, 201);
  });
}
