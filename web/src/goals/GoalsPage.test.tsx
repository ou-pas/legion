// Two gaps in the goal list, held by tests of the REAL page (real router and React Query, like
// issues-page.test.tsx):
//
//  · the list rendered the nine statuses mixed, in insertion order: last week's `failed` read as a
//    progressing goal;
//  · `POST /api/goals` returns 201 + `warning` when DoD generation fails, and the warning was shown
//    nowhere: the goal left the composer with an empty DoD and no reason.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { bootstrapApi } from "../api/bootstrap.js";
import { goalsApi, GOAL_STATUS, type Goal, type GoalStatus } from "../api/goals.js";
import type { Project } from "../api/projects.js";
import { ToastProvider } from "../ui/toast.js";
import { GOAL_TEXT } from "./text.js";
import { GoalsPage } from "./GoalsPage.js";

// `bootstrapQuery` freezes `queryFn: bootstrapApi.bootstrap` at module load: a `vi.spyOn` in
// `mount()` would come too late (see issues-page.test.tsx).
vi.mock("../api/bootstrap.js", () => ({ bootstrapApi: { bootstrap: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: Project = {
  id: "p1",
  name: "Atelier",
  slug: "atelier",
  defaultModel: "sonnet",
  repoUrl: null,
  fsRoot: null,
  context: "",
  demo: false,
  gitAuthorName: null,
  gitAuthorEmail: null,
  defaultSkillNames: "[]",
  modelRouting: "{}",
  chainBindings: "{}",
  sessionImage: null,
  sessionDockerfile: null,
  sshKeyPath: null,
  hue: null,
};

const goal = (name: string, status: GoalStatus, createdAt = "2026-09-01T09:00:00.000Z"): Goal => ({
  id: name,
  projectId: "p1",
  name,
  request: "No more ghost orders.",
  dod: [],
  plan: [],
  dodApproved: false,
  status,
  allowedAgentIds: [],
  budgetUsd: null,
  maxDurationMs: null,
  maxNoProgress: 3,
  spentUsd: 0,
  noProgressStreak: 0,
  iterations: 0,
  mock: false,
  createdAt,
  startedAt: null,
  endedAt: null,
});

function mount(goals: Goal[]) {
  vi.mocked(bootstrapApi.bootstrap).mockResolvedValue({
    projects: [project],
    agents: [],
    runners: [],
    templates: [],
  });
  vi.spyOn(goalsApi, "goals").mockResolvedValue(goals);
  const createGoal = vi.spyOn(goalsApi, "createGoal");

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const goalsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/goals",
    component: () => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <GoalsPage />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const history = createMemoryHistory({ initialEntries: ["/p/p1/goals"] });
  const router = createRouter({ routeTree: rootRoute.addChildren([goalsRoute]), history });
  render(<RouterProvider router={router} />);
  return { createGoal };
}

/** Displayed goal names in DOM order, the order being what is tested. `ui-list-title` (ui/list.tsx)
 *  is the only hook isolating the NAME from the rest of the row. */
const shownNames = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".ui-list-title")].map((n) => n.textContent ?? "");

const tab = (label: string) => screen.getByRole("tab", { name: new RegExp(`^${label}`) });

describe("GoalsPage: the state filter", () => {
  const GOALS = [
    goal("Old failure", GOAL_STATUS.failed, "2026-08-01T09:00:00.000Z"),
    goal("Payment funnel", GOAL_STATUS.active, "2026-08-20T09:00:00.000Z"),
    goal("Finished export", GOAL_STATUS.completed, "2026-09-02T09:00:00.000Z"),
    goal("Today's draft", GOAL_STATUS.draft, "2026-09-01T09:00:00.000Z"),
  ];

  it("by default the list shows ONLY what is in progress", async () => {
    mount(GOALS);
    await screen.findByText("Payment funnel");
    expect(shownNames()).toEqual(["Today's draft", "Payment funnel"]);
    expect(screen.queryByText("Old failure")).toBeNull();
    expect(screen.queryByText("Finished export")).toBeNull();
  });

  it("All shows them all, finished ones RELEGATED to the end despite their date", async () => {
    mount(GOALS);
    await screen.findByText("Payment funnel");
    fireEvent.click(tab(GOAL_TEXT.list.filterAll));
    await screen.findByText("Finished export");
    expect(shownNames()).toEqual([
      "Today's draft",
      "Payment funnel",
      "Finished export",
      "Old failure",
    ]);
  });

  it("Done keeps only finished runs", async () => {
    mount(GOALS);
    await screen.findByText("Payment funnel");
    fireEvent.click(tab(GOAL_TEXT.list.filterDone));
    await screen.findByText("Finished export");
    expect(shownNames()).toEqual(["Finished export", "Old failure"]);
  });

  it("no goal in progress: the empty state SAYS where the others are, and leads there", async () => {
    mount([goal("Finished export", GOAL_STATUS.completed)]);
    expect(await screen.findByText(GOAL_TEXT.list.emptyLive)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: GOAL_TEXT.list.showAll }));
    expect(await screen.findByText("Finished export")).toBeDefined();
  });
});

describe("GoalComposerModal: the DoD generation warning", () => {
  const fill = async () => {
    // Two create buttons on an empty list (the page's and the empty state's); the first is enough,
    // both open the same modal.
    fireEvent.click((await screen.findAllByRole("button", { name: GOAL_TEXT.list.create }))[0]!);
    fireEvent.change(await screen.findByLabelText(new RegExp(`^${GOAL_TEXT.composer.name}`)), {
      target: { value: "Harden the funnel" },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(`^${GOAL_TEXT.composer.request}`)), {
      target: { value: "No more ghost orders." },
    });
    fireEvent.click(screen.getByRole("button", { name: GOAL_TEXT.composer.generate }));
  };

  it("`generateDod` failed: the server's reason is on screen, the DoD is empty", async () => {
    const { createGoal } = mount([]);
    createGoal.mockResolvedValue({
      id: "g1",
      dod: [],
      plan: [],
      warning: "model unavailable (529)",
    });

    await fill();

    expect(await screen.findByText(GOAL_TEXT.composer.dodFailed)).toBeDefined();
    expect(await screen.findByText("model unavailable (529)")).toBeDefined();
  });

  it("successful generation: no alert banner, the criteria are editable", async () => {
    const { createGoal } = mount([]);
    createGoal.mockResolvedValue({
      id: "g1",
      plan: [],
      dod: [{ id: "d1", text: "No ghost orders", done: false }],
    });

    await fill();

    await waitFor(() =>
      expect(screen.getByLabelText(GOAL_TEXT.composer.criterion(1))).toBeDefined(),
    );
    expect(screen.queryByText(GOAL_TEXT.composer.dodFailed)).toBeNull();
  });
});
