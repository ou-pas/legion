// The question offering to rebuild a missing image (12/09).
//
// The "session image missing" preflight refusal had no way out: the queue retried the task thirty
// seconds later against the same image, forever. The fix was one click away ("Rebuild here" on
// the Infra card), but failures mostly come from the queue with nobody watching. This question
// brings that path to the channels that leave the app. Same pattern as `diagnostics.ts`.
//
// One per machine and image, deduplicated in the database on the still-open question
// (`image_rebuild`): an in-memory dedup would re-ask after a restart.
//
// This file does not act: rebuilding and parking tasks belong to the runner, reached through the
// port, as with `SessionResumer`.
import { nanoid } from "nanoid";
import { INBOX_KIND, INBOX_STATUS, ON_ANSWER } from "./inbox-enums.js";
import { WAIT_REASON } from "./wait-reason.js";
import { notifyInboxCreated } from "./notifiers.js";
import {
  agentById,
  closeInboxMessage,
  insertInboxMessage,
  lastSessionOfTask,
  openImageRebuildQuestions,
  taskNames,
  taskWithAssignee,
  type InboxRow,
} from "./image-rebuild-store.js";

/** The missing image and the machine lacking it. `projectId` matters only when `image` is the one
 *  this project declares: then the project's rebuild runs, not the fleet's. */
export interface ImageRebuildTarget {
  runnerId: string;
  runnerName: string;
  image: string;
  projectId: string;
}

/** The two outcomes. Not "retry": that id triggers a task rerun on the `retry-task` path, which
 *  would throw the task at the still-missing image. */
export const IMAGE_REBUILD_CHOICE = { rebuild: "rebuild", park: "park" } as const;

const choicesOf = (target: ImageRebuildTarget) => [
  {
    id: IMAGE_REBUILD_CHOICE.rebuild,
    label: `Rebuild “${target.image}” on “${target.runnerName}”`,
  },
  { id: IMAGE_REBUILD_CHOICE.park, label: "Save the tasks for later" },
];

/** The body, split out for tests. It names what is held back rather than counting. */
export function imageRebuildBody(target: ImageRebuildTarget, heldTasks: readonly string[]): string {
  const held = heldTasks.length > 0 ? heldTasks.map((n) => `“${n}”`).join(", ") : "no task for now";
  return (
    `The “${target.image}” image is not on runner “${target.runnerName}”: no session can start ` +
    `there. Waiting: ${held}. ` +
    "Rebuilding takes two to four minutes, after which the queue picks the tasks up on its own."
  );
}

/** An open question's target, or `null`: an unreadable JSON column (hand-repaired database) must
 *  not break reading the queue. */
export function imageRebuildTargetOf(row: {
  imageRebuild: string | null;
}): ImageRebuildTarget | null {
  if (!row.imageRebuild) return null;
  try {
    return JSON.parse(row.imageRebuild) as ImageRebuildTarget;
  } catch {
    return null;
  }
}

function alreadyAsked(target: ImageRebuildTarget): boolean {
  return openImageRebuildQuestions().some((row) => {
    const open = imageRebuildTargetOf(row);
    return open?.runnerId === target.runnerId && open.image === target.image;
  });
}

/** Asks once per machine and image. Silent if already asked or if the task has no assigned agent
 *  (the entry would belong to nobody, and the queue skips such tasks anyway). Returns the new id,
 *  or `null` if nothing was written. */
export function askImageRebuild(
  target: ImageRebuildTarget,
  held: { taskId: string; taskIds: readonly string[] },
): string | null {
  if (alreadyAsked(target)) return null;
  const task = taskWithAssignee(held.taskId);
  if (!task?.assigneeAgentId) return null;
  const body = imageRebuildBody(target, taskNames(held.taskIds));
  const choices = choicesOf(target);
  const id = nanoid(10);
  insertInboxMessage({
    id,
    // Reference only, as for a diagnostic: the refused session is already `failed`.
    sessionId: lastSessionOfTask(held.taskId)?.id ?? held.taskId,
    taskId: held.taskId,
    agentId: task.assigneeAgentId,
    kind: INBOX_KIND.choice,
    body,
    choices: JSON.stringify(choices),
    status: INBOX_STATUS.open,
    onAnswer: ON_ANSWER.rebuildImage,
    reason: WAIT_REASON.diagnostic, // a failure report from the runner, not an agent question
    imageRebuild: JSON.stringify(target),
    createdAt: new Date(),
  });
  const agent = agentById(task.assigneeAgentId);
  notifyInboxCreated({
    id,
    kind: INBOX_KIND.choice,
    body,
    choices,
    blocking: true,
    taskName: task.name,
    agentName: agent?.name ?? "?",
  });
  return id;
}

/** Closes open questions for this machine and image once the wait is lifted, so "Rebuild" is not
 *  offered for an image that came back. `closed`, not `answered`: nobody answered. */
export function closeImageRebuildQuestions(target: { runnerId: string; image: string }): void {
  for (const row of openImageRebuildQuestions()) {
    const open = imageRebuildTargetOf(row);
    if (open?.runnerId === target.runnerId && open.image === target.image)
      closeInboxMessage(row.id);
  }
}

/** What the answer asks for, from the entry and the clicked choice. `null` = nothing to do: no
 *  target, or free text without a choice (no rebuild on a sentence). */
export function imageRebuildDecision(
  row: Pick<InboxRow, "imageRebuild">,
  choiceId: string | undefined,
): { target: ImageRebuildTarget; choice: "rebuild" | "park" } | null {
  const target = imageRebuildTargetOf(row);
  if (!target) return null;
  if (choiceId === IMAGE_REBUILD_CHOICE.rebuild) return { target, choice: "rebuild" };
  if (choiceId === IMAGE_REBUILD_CHOICE.park) return { target, choice: "park" };
  return null;
}
