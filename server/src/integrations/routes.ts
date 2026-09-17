// Routes of the integrations domain: Linear issues.
import { Hono } from "hono";
import { listIssues, listOptions } from "../integrations/linear.js";

export function registerIntegrationRoutes(app: Hono): void {
  // Linear: issues to tasks (v9). The three filters come in the query and go to Linear (01/09):
  // applying them here, on the fifty already fetched, searched only the most recent issues.
  app.get("/api/linear/issues", async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    try {
      return c.json(
        await listIssues(projectId, {
          assigneeId: c.req.query("assigneeId"),
          teamId: c.req.query("teamId"),
          state: c.req.query("state"),
        }),
      );
    } catch (e) {
      return c.json({ error: String((e as Error).message) }, 502);
    }
  });

  // What the menus are made of: the workspace's members, teams and state labels. Separate from the
  // issue list because it does not depend on the current filter, which keeps the menu from shrinking
  // as it is used.
  app.get("/api/linear/options", async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    try {
      return c.json(await listOptions(projectId));
    } catch (e) {
      return c.json({ error: String((e as Error).message) }, 502);
    }
  });
}
