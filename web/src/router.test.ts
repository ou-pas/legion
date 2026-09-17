// A section is a URL (slice nav/09, AC#1). This prevents settings and library from silently going back
// to tabs: a tab is tested by clicking, a URL by pasting, and the second property was the lost one.
//
// It mounts the REAL router tree, not a copy (a copied tree only proves its own consistency). No
// rendering: `router.load()` resolves matches and plays redirects, enough for the three questions:
// which route serves this URL, where the bare URL lands, and what back does.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, type AnyRouter } from "@tanstack/react-router";
import { routeTree } from "./router.js";
import { qk } from "./queries.js";
import {
  CAPABILITY_ROWS,
  PROJECT_ROWS,
  SETTINGS_ROWS,
  TASK_ROWS,
} from "./projects/rail-sections.js";
import { TASK_VIEWS, TASK_VIEW_PATH } from "./tasks/task-views.js";
import { TASK_STATUS } from "./api/tasks.js";

const PROJECT_ID = "p1";
const TASK_ID = "tk42";
const AGENT_ID = "ag99";

/** The bootstrap is SEEDED rather than served: `projectRoute` refuses an unknown project id, and a
 *  section path must go through that guard. The task list is seeded for the SAME reason: the old
 *  `/tasks/<id>` reads the task's project before redirecting; without it the test would prove a request
 *  fails, not that a redirect aims right. */
function mount(path: string): {
  router: AnyRouter;
  history: ReturnType<typeof createMemoryHistory>;
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(qk.bootstrap, {
    projects: [{ id: PROJECT_ID, name: "Legion", slug: "legion" }],
    agents: [{ id: AGENT_ID, projectId: PROJECT_ID, name: "Un agent", title: "" }],
    templates: [],
  });
  queryClient.setQueryData(qk.tasks, {
    tasks: [{ id: TASK_ID, projectId: PROJECT_ID, name: "A task", status: TASK_STATUS.todo }],
    sessions: [],
  });
  // The full record: `pTaskRoute` preloads it apart from the list above (`taskQuery`), or its loader
  // would hit the network during the test.
  queryClient.setQueryData(qk.task(TASK_ID), {
    id: TASK_ID,
    projectId: PROJECT_ID,
    name: "A task",
    status: TASK_STATUS.todo,
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  return { router: createRouter({ routeTree, history, context: { queryClient } }), history };
}

const path = (to: string) => to.replace("$projectId", PROJECT_ID);

const SECTIONS = [...SETTINGS_ROWS, ...CAPABILITY_ROWS].filter((r) => !("back" in r));

describe("each section is a URL", () => {
  it.each(SECTIONS.map((s) => s.to))("%s is served by its own route", async (to) => {
    const { router } = mount(path(to));
    await router.load();
    // The last match is the LEAF, which mounts the screen. Comparing the path alone would let a
    // catch-all route through.
    expect(router.state.matches.at(-1)?.routeId).toBe(to);
  });

  it("the rail only points to existing routes", () => {
    const { router } = mount("/");
    const served = new Set(Object.keys(router.routesById));
    for (const row of [...PROJECT_ROWS, ...SETTINGS_ROWS, ...CAPABILITY_ROWS, ...TASK_ROWS]) {
      expect(served.has(row.to), row.to).toBe(true);
    }
  });
});

describe("old URLs keep working", () => {
  it.each([
    ["/p/$projectId/project", "/p/p1/project/general"],
    ["/p/$projectId/libraries", "/p/p1/libraries/skills"],
  ])("%s lands on its first section", async (nue, premiere) => {
    const { router, history } = mount(path(nue));
    await router.load();
    expect(router.state.location.pathname).toBe(premiere);
    // `replace`: the redirect step does not stay in history, or back would fall onto it and be sent
    // forward again.
    expect(history.length).toBe(1);
  });

  // Settings › Chains merged into Library › Chains on 12/09: the URL stays for existing links but
  // redirects, straight to /libraries/chains rather than /capabilities/chaines, which redirects itself.
  it("/project/chaines redirige vers /libraries/chains", async () => {
    const { router, history } = mount(path("/p/$projectId/project/chaines"));
    await router.load();
    expect(router.state.location.pathname).toBe("/p/p1/libraries/chains");
    expect(history.length).toBe(1);
  });
});

// Nav work batch 5 (12/09): paths went English. The five old French System URLs stay SERVED, redirecting
// straight to the new one.
describe("System paths are English, the old path redirects", () => {
  it.each([
    ["/systeme", "/system/general"],
    ["/systeme/infra", "/system/runners"],
    ["/systeme/journal", "/system/logs"],
    ["/systeme/statistiques", "/system/analytics"],
    ["/systeme/general", "/system/general"],
  ])("%s redirects to %s, without history entry", async (from, to) => {
    const { router, history } = mount(from);
    await router.load();
    expect(router.state.location.pathname).toBe(to);
    expect(history.length).toBe(1);
  });

  // /infra, /logs, /analytics target the new URL directly rather than bouncing through `/systeme/...`.
  it.each([
    ["/infra", "/system/runners"],
    ["/logs", "/system/logs"],
    ["/analytics", "/system/analytics"],
  ])("l'adresse historique %s vise directement %s", async (from, to) => {
    const { router, history } = mount(from);
    await router.load();
    expect(router.state.location.pathname).toBe(to);
    expect(history.length).toBe(1);
  });
});

// Batch 5 (12/09): `canaux` → `channels`.
describe("canaux became channels, the old path redirects", () => {
  it.each([
    ["/p/$projectId/canaux", "/p/p1/channels"],
    ["/p/$projectId/canaux/$taskId", `/p/p1/channels/${TASK_ID}`],
  ])("%s redirects to %s, without history entry", async (from, to) => {
    const { router, history } = mount(path(from).replace("$taskId", TASK_ID));
    await router.load();
    expect(router.state.location.pathname).toBe(to);
    expect(history.length).toBe(1);
  });
});

// Batch 5 (12/09): `planifiees` → `scheduled`.
describe("planifiees became scheduled, the old path redirects", () => {
  it("/planifiees redirects to /scheduled, without history entry", async () => {
    const { router, history } = mount(path("/p/$projectId/planifiees"));
    await router.load();
    expect(router.state.location.pathname).toBe("/p/p1/scheduled");
    expect(history.length).toBe(1);
  });
});

// Batch 5 (12/09): three project sections went English.
describe("project sections are English, the old path redirects", () => {
  it.each([
    ["/p/$projectId/project/modeles", "/p/p1/project/models"],
    ["/p/$projectId/project/execution", "/p/p1/project/runtime"],
    ["/p/$projectId/project/coffre", "/p/p1/project/crate"],
  ])("%s redirects to %s, without history entry", async (from, to) => {
    const { router, history } = mount(path(from));
    await router.load();
    expect(router.state.location.pathname).toBe(to);
    expect(history.length).toBe(1);
  });
});

// Batch 5 (12/09): `capabilities` → `libraries`, `regles` → `rules`. The six old URLs redirect directly.
describe("the library paths are English, the old path redirects", () => {
  it.each([
    ["/p/$projectId/capabilities", "/p/p1/libraries/skills"],
    ["/p/$projectId/capabilities/skills", "/p/p1/libraries/skills"],
    ["/p/$projectId/capabilities/regles", "/p/p1/libraries/rules"],
    ["/p/$projectId/capabilities/chaines", "/p/p1/libraries/chains"],
    ["/p/$projectId/capabilities/mcp", "/p/p1/libraries/mcp"],
    ["/p/$projectId/capabilities/environments", "/p/p1/libraries/environments"],
  ])("%s redirects to %s, without history entry", async (from, to) => {
    const { router, history } = mount(path(from));
    await router.load();
    expect(router.state.location.pathname).toBe(to);
    expect(history.length).toBe(1);
  });
});

// Batch G (12/09): four URLs nothing showed or linked to anymore, removed rather than redirected. Unlike
// the others in this file they LEAD NOWHERE: the global 404 (`defaultNotFoundComponent`, `router.tsx`).
describe("ghost URLs are removed from the router, not redirected (batch G, 12/09)", () => {
  it.each([
    "/inbox",
    "/systeme/modeles",
    `/p/${PROJECT_ID}/taches/${TASK_ID}/settings`,
    `/p/${PROJECT_ID}/taches/${TASK_ID}/diff`,
  ])("%s redirects nowhere and serves no screen", async (from) => {
    const { router } = mount(from);
    await router.load();
    // No redirect: unlike kept URLs, the URL does not move.
    expect(router.state.location.pathname).toBe(from);
    // No route of the tree renders this URL.
    expect(router.state.matches.some((m) => m.routeId === from)).toBe(false);
  });
});

// Batch nav/2a: General absorbed Context. The old URL stays SERVED (bookmarks, muscle memory) but
// redirects. `repos` is not here: its screen grew, its URL did not move.
describe("general absorbed the old context URL", () => {
  it("/p/p1/project/contexte redirects to general, without history entry", async () => {
    const { router, history } = mount("/p/p1/project/contexte");
    await router.load();
    expect(router.state.location.pathname).toBe("/p/p1/project/general");
    expect(history.length).toBe(1);
  });
});

// The concierge is a page, and so are its conversations (12/09). A thread one cannot reload, send or find
// with back only lasts an instant. The conversation list lives ON this page; opening one navigates to the
// sibling route `/concierge/$conversationId`.
describe("the concierge is a URL, and so are its conversations", () => {
  it("the brief has its route", async () => {
    const { router } = mount("/concierge");
    await router.load();
    expect(router.state.matches.at(-1)?.routeId).toBe("/concierge");
  });

  it("a conversation has its URL, and the id comes back from it", async () => {
    const { router } = mount("/concierge/aB3x9Zqw01");
    await router.load();
    const last = router.state.matches.at(-1);
    expect(last?.routeId).toBe("/concierge/$conversationId");
    expect((last?.params as { conversationId?: string } | undefined)?.conversationId).toBe(
      "aB3x9Zqw01",
    );
  });

  it.each([
    ["/concierge/conversations", "/concierge"],
    ["/concierge/conversations/aB3x9Zqw01", "/concierge/aB3x9Zqw01"],
  ])("the old URL %s redirects to %s, without history entry", async (nue, cible) => {
    const { router, history } = mount(nue);
    await router.load();
    expect(router.state.location.pathname).toBe(cible);
    // `replace`: otherwise back falls onto the redirect, which goes forward again.
    expect(history.length).toBe(1);
  });
});

// A task is in a project (slice nav/13, AC#1): `tasks.project_id` is `NOT NULL`. This prevents two
// things: the old URL stopping to work (about twenty links still point there without the project), and
// an id designating nothing going to a URL built with an unknown project, replacing one error by another.
describe("a task URL carries its project", () => {
  it("the canonical route lives under the project", async () => {
    const { router } = mount(`/p/${PROJECT_ID}/tasks/${TASK_ID}`);
    await router.load();
    // The BARE URL lands on the index route: no redirect here, the page resolves to the most useful view.
    expect(router.state.matches.at(-1)?.routeId).toBe("/p/$projectId/tasks/$taskId/");
  });

  it("the old URL redirects to the canonical one, without history entry", async () => {
    const { router, history } = mount(`/tasks/${TASK_ID}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}`);
    // `replace`: otherwise back falls onto the redirect, which goes forward again.
    expect(history.length).toBe(1);
  });

  it("an id designating nothing redirects nowhere", async () => {
    const { router } = mount("/tasks/unknown-id");
    await router.load();
    expect(router.state.location.pathname).toBe("/tasks/unknown-id");
    // The absence page, not `/p/undefined/tasks/unknown-id`.
    expect(router.state.matches.at(-1)?.routeId).toBe("/tasks/$taskId");
  });
});

// Batch 5 (12/09): `taches` → `tasks`. The old URL AND its views redirect directly.
describe("taches became tasks, the old path redirects", () => {
  it("the bare URL redirects to the canonical one, without history entry", async () => {
    const { router, history } = mount(`/p/${PROJECT_ID}/taches/${TASK_ID}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}`);
    expect(history.length).toBe(1);
  });

  it.each(TASK_VIEWS)("%s redirects to its view, without history entry", async (v) => {
    const { router, history } = mount(`/p/${PROJECT_ID}/taches/${TASK_ID}/${v}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}/${v}`);
    expect(history.length).toBe(1);
  });

  // `search: true` on the bare URL only (router.tsx): a legacy `?vue=` pasted on the OLD project URL must
  // still land on its segment: two redirects, zero history entries.
  it("a legacy ?vue= on the old URL lands on its segment", async () => {
    const { router, history } = mount(`/p/${PROJECT_ID}/taches/${TASK_ID}?vue=notes`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}/notes`);
    expect(history.length).toBe(1);
  });
});

// A view is a URL (slice nav/17, AC#1). This prevents a task's views from silently going back to a tab
// bar: a tab is tested by clicking, a URL by pasting.
describe("each task view is a URL", () => {
  const view = (v: string) => `/p/${PROJECT_ID}/tasks/${TASK_ID}/${v}`;

  it.each(TASK_VIEWS)("%s is served by its own route", async (v) => {
    const { router } = mount(view(v));
    await router.load();
    // The last match is the LEAF, which mounts the screen. Comparing the path alone would let a
    // catch-all route through.
    expect(router.state.matches.at(-1)?.routeId).toBe(TASK_VIEW_PATH[v]);
  });

  it("the document title NAMES the view and the task", async () => {
    // The tabs shared one title: three tasks open in three browser tabs could not be told apart.
    const { router } = mount(view("pr"));
    await router.load();
    const meta = router.state.matches.at(-1)?.meta as { title?: string }[] | undefined;
    expect(meta?.[0]?.title).toBe("PR · A task · Legion");
  });

  it("back returns to the previous view", async () => {
    const { router, history } = mount(view("brief"));
    await router.load();

    await router.navigate({
      to: TASK_VIEW_PATH.pr,
      params: { projectId: PROJECT_ID, taskId: TASK_ID },
    });
    expect(history.location.pathname).toBe(view("pr"));

    // THE property a `replace` query-string tab lacked: switching views leaves a history trace, so the
    // gesture can be undone.
    history.back();
    expect(history.location.pathname).toBe(view("brief"));
  });
});

// Old `?vue=` links (slice nav/17, AC#1): in URLs since slice 06, so in bookmarks and messages, and they
// must keep working.
describe("a legacy ?vue= leads to the right segment", () => {
  it.each(TASK_VIEWS)("?vue=%s lands on its segment, without history entry", async (v) => {
    const { router, history } = mount(`/p/${PROJECT_ID}/tasks/${TASK_ID}?vue=${v}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}/${v}`);
    // The param does not linger: one canonical URL per view, or the rail would not know which to light.
    expect(router.state.location.search).toEqual({});
    expect(history.length).toBe(1);
  });

  it("from the OLD global URL too: two redirects, zero entries", async () => {
    const { router, history } = mount(`/tasks/${TASK_ID}?vue=notes`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}/notes`);
    expect(history.length).toBe(1);
  });

  // Diff joined PR (05/09): a legacy `?vue=diff` still leads to the PR view (`RETIRED_TASK_VIEWS` in
  // `tasks/task-views.ts`). The `/diff` SEGMENT was removed on 12/09 and now hits the app 404.
  it("the legacy ?vue=diff leads to pr, without history entry", async () => {
    const { router, history } = mount(`/p/${PROJECT_ID}/tasks/${TASK_ID}?vue=diff`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}/pr`);
    expect(router.state.matches.at(-1)?.routeId).toBe(TASK_VIEW_PATH.pr);
    expect(history.length).toBe(1);
  });

  it("an unknown view breaks nothing: we stay on the bare URL, which the page resolves", async () => {
    // A URL is typed, truncated and repasted by humans: `?vue=nimportequoi` must not produce an error
    // screen, `parseTaskView`'s contract.
    const { router } = mount(`/p/${PROJECT_ID}/tasks/${TASK_ID}?vue=nimportequoi`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/tasks/${TASK_ID}`);
    expect(router.state.matches.at(-1)?.routeId).toBe("/p/$projectId/tasks/$taskId/");
  });
});

// An agent is in a project (`agents.project_id` is `NOT NULL`). This prevents the old URL from breaking
// (palette and registry links point there) and an unknown id from going to a URL built with an unknown
// project.
describe("an agent URL carries its project", () => {
  it("the canonical route lives under the project", async () => {
    const { router } = mount(`/p/${PROJECT_ID}/agents/${AGENT_ID}`);
    await router.load();
    expect(router.state.matches.at(-1)?.routeId).toBe("/p/$projectId/agents/$agentId");
  });

  it("the old URL redirects to the canonical one, without history entry", async () => {
    const { router, history } = mount(`/agents/${AGENT_ID}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/agents/${AGENT_ID}`);
    // `replace`: otherwise back falls onto the redirect, which goes forward again.
    expect(history.length).toBe(1);
  });

  it("an id designating nothing redirects nowhere", async () => {
    const { router } = mount("/agents/unknown-id");
    await router.load();
    expect(router.state.location.pathname).toBe("/agents/unknown-id");
    // The 404 page, not `/p/undefined/agents/unknown-id`.
    expect(router.state.matches.at(-1)?.routeId).toBe("/agents/$agentId");
  });
});

describe("the back button", () => {
  it("returns to the previous section", async () => {
    const { router, history } = mount("/p/p1/project/repos");
    await router.load();

    await router.navigate({
      to: "/p/$projectId/project/crate",
      params: { projectId: PROJECT_ID },
    });
    expect(history.location.pathname).toBe("/p/p1/project/crate");

    // THE property a `useState` tab could not have: switching subject leaves a history trace, so the
    // gesture can be undone.
    history.back();
    expect(history.location.pathname).toBe("/p/p1/project/repos");
  });
});
