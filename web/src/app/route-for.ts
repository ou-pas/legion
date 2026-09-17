import type { LookupHit } from "../api/bootstrap.js";

/** Where an id found by ⌘K leads. A task, a goal and an agent each have one URL under their project
 *  (tasks/goals/agents.project_id are all NOT NULL on the server, `server/src/http/lookup.ts`); the
 *  web type keeps `projectId: string | null` out of caution, so this returns `null` rather than guess
 *  a short URL that would redirect anyway. A project has no `projectId`: its own id opens its board,
 *  like the palette's project entries. */
export function routeFor(hit: LookupHit) {
  switch (hit.kind) {
    case "task":
      return hit.projectId
        ? ({
            to: "/p/$projectId/tasks/$taskId",
            params: { projectId: hit.projectId, taskId: hit.id },
          } as const)
        : null;
    case "goal":
      return hit.projectId
        ? ({
            to: "/p/$projectId/goals/$goalId",
            params: { projectId: hit.projectId, goalId: hit.id },
          } as const)
        : null;
    case "agent":
      return hit.projectId
        ? ({
            to: "/p/$projectId/agents/$agentId",
            params: { projectId: hit.projectId, agentId: hit.id },
          } as const)
        : null;
    case "project":
      return { to: "/p/$projectId/board", params: { projectId: hit.id } } as const;
  }
}
