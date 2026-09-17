import { describe, expect, it } from "vitest";
import type { LookupHit } from "../api/bootstrap.js";
import { routeFor } from "./route-for.js";

const hit = (kind: LookupHit["kind"], projectId: string | null): LookupHit => ({
  kind,
  id: "abc123",
  label: "abc123",
  projectId,
});

describe("routeFor", () => {
  it("task → canonical URL under its project", () => {
    expect(routeFor(hit("task", "p1"))).toEqual({
      to: "/p/$projectId/tasks/$taskId",
      params: { projectId: "p1", taskId: "abc123" },
    });
  });

  it("goal → canonical URL under its project", () => {
    expect(routeFor(hit("goal", "p1"))).toEqual({
      to: "/p/$projectId/goals/$goalId",
      params: { projectId: "p1", goalId: "abc123" },
    });
  });

  it("agent → canonical URL under its project", () => {
    expect(routeFor(hit("agent", "p1"))).toEqual({
      to: "/p/$projectId/agents/$agentId",
      params: { projectId: "p1", agentId: "abc123" },
    });
  });

  it("project → its board, without going through projectId", () => {
    expect(routeFor(hit("project", null))).toEqual({
      to: "/p/$projectId/board",
      params: { projectId: "abc123" },
    });
  });

  it("no projectId on a task/goal/agent: null, no dead link", () => {
    expect(routeFor(hit("task", null))).toBeNull();
    expect(routeFor(hit("goal", null))).toBeNull();
    expect(routeFor(hit("agent", null))).toBeNull();
  });
});
