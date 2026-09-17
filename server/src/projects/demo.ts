// The demonstration project, opened by the side door of the no-project screen, so one can see
// Legion before connecting a repository.
//
// The `demo` flag cuts every launch point (runTask, resume, goal loop; see `isDemoProject`), so
// "nothing runs, nothing costs" is held by the server, not by a UI instruction.
//
// Idempotent: called twice, the door returns the same project rather than stacking a second one.
import { nanoid } from "nanoid";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { NETWORKING } from "../shared/enums.js";
import { logControlEvent } from "../events/control-log-store.js";
import { insertDemoProject, projectBySlug } from "./demo-store.js";

export const DEMO_SLUG = "demonstration";

/** Three cards in three columns: an empty board demonstrates nothing, and the board is the first
 *  thing seen in a project. Ascending `boardOrder` is top of column (see task-move.ts). */
const DEMO_TASKS = [
  {
    name: "Migrate the blocker reader",
    status: TASK_STATUS.doing,
    description: "A task in flight, with its agent assigned.",
  },
  {
    name: "Review the capabilities page",
    status: TASK_STATUS.review,
    description: "A task waiting for a human decision.",
  },
  {
    name: "Clean up the orphan environments",
    status: TASK_STATUS.todo,
    description: "A task written down, not picked up yet.",
  },
];

export function ensureDemoProject(): { id: string; created: boolean } {
  const existing = projectBySlug(DEMO_SLUG);
  if (existing) return { id: existing.id, created: false };

  const now = new Date();
  const projectId = nanoid(10);
  const environmentId = nanoid(10);
  const agentId = nanoid(10);
  insertDemoProject({
    project: { id: projectId, name: "Demonstration", slug: DEMO_SLUG, demo: true, createdAt: now },
    // An environment and an agent like any new project, or the board opens onto empty settings
    // screens.
    environment: {
      id: environmentId,
      projectId,
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    },
    agent: {
      id: agentId,
      projectId,
      name: "senior-dev",
      title: "Senior developer (demonstration)",
      environmentId,
      // Reconstructed from Danny Postma's Legion talk — not his verbatim prompt
      rolePrompt:
        "You are a senior developer. Do the assigned task with the tools you have. Finish or report if stuck.",
      fsGrants: JSON.stringify([
        { folderPath: "/agents/senior-dev", canRead: true, canWrite: true, canDelete: false },
      ]),
      createdAt: now,
    },
    tasks: DEMO_TASKS.map((t, i) => ({
      id: nanoid(10),
      projectId,
      name: t.name,
      description: t.description,
      status: t.status,
      boardOrder: i,
      assigneeAgentId: agentId,
      createdAt: now,
      updatedAt: now,
    })),
  });
  logControlEvent(
    "info",
    "seed",
    "demonstration project created (side door of the no-project screen)",
    { projectId },
  );
  return { id: projectId, created: true };
}
