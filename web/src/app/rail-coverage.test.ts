// No screen without a rail, except those named here.
//
// `railSectionOf` (rail-slot.tsx) answers "which rail at this URL", and its test says it answers
// right. It says nothing about what matters: do the URLs the app SERVES fall into a family it knows?
// For weeks the answer was no for `/chains/$runId`, which lived at the root because a run already
// carries its project: true of the model, false of the screen, since the RAIL comes from the project
// (operator finding, 15/09; same defect as the goal page on 02/09). So this test reads the REAL tree
// (`routeTree`), not a copied list.
//
// The rule: a route rendering a screen sits under a family the rail knows. Two kinds escape:
//  · routes that REDIRECT (`beforeLoad`): their component is only a fallback when the id designates
//    nothing (`/tasks/$taskId` renders `TaskAbsent`), an error page, not a working screen;
//  · routes NAMED below, with the reason.
//
// It fails both ways, like the repo baselines: an unnamed URL without rail fails, and an exception
// matching nothing anymore fails too, or the list becomes a graveyard nobody dares empty.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { railSectionOf } from "./rail-slot.js";
import { routeTree } from "../router.js";

/** Screens WITHOUT a rail, and why. Just one, and not by oversight.
 *
 *  The concierge left this list on 16/09: `railSectionOf` gives it its OWN section (`"concierge"`,
 *  distinct from `null`) so the phone bottom bar offers an exit. The rail still shows nothing there
 *  (`railNavOf` returns `null` for it), but `rail-slot.test.tsx` checks that now. */
const NO_RAIL = new Map([["/", "The no-project screen: there is no context to carry yet."]]);

type RouteShape = {
  fullPath?: string;
  options?: { component?: unknown; beforeLoad?: unknown };
};

/** URLs rendering a screen WITHOUT ever redirecting: those that must carry a rail. */
function screensServed(): string[] {
  // The context is required by typing (the loaders' `queryClient`) but no loader runs here: we
  // navigate nowhere, we read the route TABLE.
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
  const seen = new Set<string>();
  for (const route of Object.values(router.routesById) as RouteShape[]) {
    const path = route.fullPath ?? "";
    if (!route.options?.component || route.options.beforeLoad) continue;
    seen.add(path);
  }
  return [...seen].sort();
}

describe("the rail covers the served screens", () => {
  it("no URL renders a screen without rail, apart from the named ones", () => {
    const naked = screensServed().filter((p) => railSectionOf(p) === null && !NO_RAIL.has(p));
    expect(
      naked,
      [
        "These URLs render a screen no rail family covers:",
        ...naked,
        "",
        "Either the screen belongs to a project and its URL must move under /p/$projectId",
        "(pattern of /tasks, /goals, /agents, /chains: a short URL that redirects, canonical",
        "route under the project); or it truly has no sub-navigation, and it is declared in",
        "NO_RAIL with its reason.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("no stale exception: every NO_RAIL URL is still served without rail", () => {
    const served = new Set(screensServed());
    const stale = [...NO_RAIL.keys()].filter((p) => !served.has(p) || railSectionOf(p) !== null);
    expect(
      stale,
      [
        "These exceptions match nothing anymore: the URL changed, disappeared, or carries a",
        "rail now. Remove the line: a list never pruned stops being read.",
        ...stale,
      ].join("\n"),
    ).toEqual([]);
  });
});
