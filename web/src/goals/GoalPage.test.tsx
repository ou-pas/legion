// A `draft` goal had NO way to be approved from the UI: `approveGoal` was only called in
// GoalComposerModal. A goal created outside the composer (direct POST /api/goals, or modal closed
// before approval) stayed stuck forever, with no button showing it. This test mounts the REAL page
// (real router + React Query, like issues-page.test.tsx): a pure-function test would prove neither
// that the button depends on status nor that the call sends the displayed DoD.
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
import {
  goalsApi,
  type Goal,
  type GoalDetail,
  type GoalFootprint,
  type GoalPatch,
  type LiveGoalSession,
  type UnblockedTask,
} from "../api/goals.js";
import { ToastProvider } from "../ui/toast.js";
import { GOAL_TEXT } from "./text.js";
import { GoalPage } from "./GoalPage.js";
import { GOAL_STATUS } from "../api/goals.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A zero footprint (D12), the common case: a never-approved `draft` goal. */
const emptyFootprint = (): GoalFootprint => ({
  tasks: 0,
  sessions: 0,
  sessionEvents: 0,
  inbox: 0,
  reviewComments: 0,
  activity: 0,
  goalEvents: 0,
  artifactsDir: false,
});

const goal = (over: Partial<GoalDetail> = {}): GoalDetail => ({
  id: "g1",
  projectId: "p1",
  name: "Harden the payment funnel",
  request: "No more ghost orders after a declined payment.",
  dod: [
    { id: "d1", text: "Definition of Done", done: false },
    { id: "d2", text: "Plan", done: false },
  ],
  plan: [],
  dodApproved: false,
  status: GOAL_STATUS.draft,
  allowedAgentIds: [],
  budgetUsd: null,
  maxDurationMs: null,
  maxNoProgress: 3,
  spentUsd: 0,
  noProgressStreak: 0,
  iterations: 0,
  mock: false,
  createdAt: "2026-09-01T09:00:00.000Z",
  startedAt: null,
  endedAt: null,
  events: [],
  tasks: [],
  ...over,
});

function mount(
  initial: GoalDetail,
  footprint: {
    footprint: GoalFootprint;
    live?: LiveGoalSession[];
    unblocks?: UnblockedTask[];
  } | null = { footprint: emptyFootprint() },
) {
  vi.spyOn(goalsApi, "goal").mockResolvedValue(initial);
  const approveGoal = vi.spyOn(goalsApi, "approveGoal").mockResolvedValue({});
  const goalFootprint = footprint
    ? vi
        .spyOn(goalsApi, "goalFootprint")
        .mockResolvedValue({ live: [], unblocks: [], ...footprint })
    : // `null`: the request never resolves, reproducing the not-yet-answered case.
      vi.spyOn(goalsApi, "goalFootprint").mockReturnValue(new Promise(() => {}));
  const deleteGoal = vi.spyOn(goalsApi, "deleteGoal");
  const editGoal = vi.spyOn(goalsApi, "editGoal").mockImplementation((id, patch) =>
    Promise.resolve({
      ok: true,
      goal: { ...initial, ...patch } as unknown as Goal,
      changed: Object.keys(patch) as (keyof GoalPatch)[],
    }),
  );
  const regenerateGoal = vi
    .spyOn(goalsApi, "regenerateGoal")
    .mockResolvedValue({ ok: true, dod: [], plan: [] });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const goalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/$goalId",
    component: () => <GoalPage />,
  });
  // Post-deletion navigation target (D8): a sibling route, not a child of the goal.
  const goalsListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/goals",
    component: () => <div>Goal list</div>,
  });
  const history = createMemoryHistory({ initialEntries: [`/goals/${initial.id}`] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([goalRoute, goalsListRoute]),
    history,
  });
  // ToastProvider ABOVE the router (as in `router.tsx`): a toast fired right before a navigation must
  // survive the unmount of the page that raised it.
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { approveGoal, goalFootprint, deleteGoal, editGoal, regenerateGoal, history };
}

const approveButton = () => screen.findByRole("button", { name: GOAL_TEXT.composer.approve });
const deleteButton = () => screen.findByRole("button", { name: GOAL_TEXT.page.delete });

describe("GoalPage: approving a `draft` goal", () => {
  it("a `draft` goal shows the approve button", async () => {
    mount(goal({ status: GOAL_STATUS.draft }));
    expect(await approveButton()).toBeDefined();
  });

  it("an `active` goal does not", async () => {
    mount(goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }));
    await screen.findByText("Harden the payment funnel");
    expect(screen.queryByRole("button", { name: GOAL_TEXT.composer.approve })).toBeNull();
  });

  it("a `paused` goal does not", async () => {
    mount(goal({ status: GOAL_STATUS.paused, startedAt: "2026-09-01T09:00:00.000Z" }));
    await screen.findByText("Harden the payment funnel");
    expect(screen.queryByRole("button", { name: GOAL_TEXT.composer.approve })).toBeNull();
  });

  it("sends the DISPLAYED DoD items (edited before sending) and invalidates the goal query", async () => {
    const { approveGoal } = mount(goal({ status: GOAL_STATUS.draft }));

    // A generated DoD can come out degenerate (items "Definition of Done" / "Plan"): correcting it
    // before approval is the only moment a human can catch it.
    const first = await screen.findByLabelText(GOAL_TEXT.composer.criterion(1));
    fireEvent.change(first, { target: { value: "No ghost order after a decline" } });

    fireEvent.click(await approveButton());

    await waitFor(() =>
      expect(approveGoal).toHaveBeenCalledWith("g1", [
        { id: "d1", text: "No ghost order after a decline" },
        { id: "d2", text: "Plan" },
      ]),
    );

    // The invalidated query refetches: `goalsApi.goal` is called a second time.
    await waitFor(() =>
      expect(vi.mocked(goalsApi.goal).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("an empty DoD is still refused by the server, and the message is relayed in a toast", async () => {
    const { approveGoal } = mount(goal({ status: GOAL_STATUS.draft, dod: [] }));
    approveGoal.mockRejectedValueOnce(new Error("empty DoD"));

    fireEvent.click(await approveButton());

    expect(await screen.findByText("empty DoD")).toBeDefined();
    expect(await screen.findByText(GOAL_TEXT.page.actionRefused.approve)).toBeDefined();
  });
});

describe("GoalPage: deleting a goal (D1-D12)", () => {
  it("zero footprint: the D12 sentence replaces the footprint, and the armed label lists nothing", async () => {
    mount(goal({ status: GOAL_STATUS.draft }), { footprint: emptyFootprint() });

    expect(await screen.findByText(GOAL_TEXT.page.deleteEmpty)).toBeDefined();
    fireEvent.click(await deleteButton());
    expect(
      await screen.findByRole("button", { name: GOAL_TEXT.page.deleteConfirm([]) }),
    ).toBeDefined();
  });

  it("non-empty footprint: the sentence names tasks, sessions, log AND artifacts folder (D9)", async () => {
    mount(goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }), {
      footprint: {
        tasks: 3,
        sessions: 2,
        sessionEvents: 40,
        inbox: 1,
        reviewComments: 0,
        activity: 5,
        goalEvents: 6,
        artifactsDir: true,
      },
    });

    expect(
      await screen.findByText(
        "Deleting this goal will also destroy 3 tasks, 2 sessions, the log, the artifacts folder.",
      ),
    ).toBeDefined();
    fireEvent.click(await deleteButton());
    expect(
      await screen.findByRole("button", {
        name: "Confirm — 3 tasks, 2 sessions, the log, the artifacts folder",
      }),
    ).toBeDefined();
  });

  it("a `committing` session: the button is ABSENT, the reason reads next to it (D5, never disabled+title)", async () => {
    mount(goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }), {
      footprint: {
        tasks: 1,
        sessions: 1,
        sessionEvents: 3,
        inbox: 0,
        reviewComments: 0,
        activity: 1,
        goalEvents: 1,
        artifactsDir: true,
      },
      live: [{ id: "s1", status: "committing", taskName: "Push the branch" }],
    });

    expect(await screen.findByText(/Push the branch — committing/)).toBeDefined();
    expect(screen.queryByRole("button", { name: GOAL_TEXT.page.delete })).toBeNull();
  });

  it("tasks outside the goal will be unblocked: they are named UNDER the button, before the click (D10)", async () => {
    mount(goal({ status: GOAL_STATUS.draft }), {
      footprint: {
        tasks: 1,
        sessions: 0,
        sessionEvents: 0,
        inbox: 0,
        reviewComments: 0,
        activity: 0,
        goalEvents: 1,
        artifactsDir: false,
      },
      unblocks: [{ id: "t9", name: "Deploy the gateway" }],
    });

    await deleteButton();
    expect(await screen.findByText(/Deploy the gateway/)).toBeDefined();
  });

  it("success: summary toast then navigation to the project's goal list", async () => {
    const { deleteGoal, history } = mount(goal({ status: GOAL_STATUS.draft }), {
      footprint: {
        tasks: 2,
        sessions: 1,
        sessionEvents: 4,
        inbox: 0,
        reviewComments: 0,
        activity: 2,
        goalEvents: 3,
        artifactsDir: true,
      },
    });
    deleteGoal.mockResolvedValue({
      ok: true,
      deleted: "Harden the payment funnel",
      footprint: {
        tasks: 2,
        sessions: 1,
        sessionEvents: 4,
        inbox: 0,
        reviewComments: 0,
        activity: 2,
        goalEvents: 3,
        artifactsDir: true,
      },
      unblocked: [],
      closedWaits: [],
    });

    fireEvent.click(await deleteButton());
    fireEvent.click(await screen.findByRole("button", { name: /^Confirm/ }));

    await waitFor(() => expect(deleteGoal).toHaveBeenCalledWith("g1"));
    expect(await screen.findByText("“Harden the payment funnel” deleted")).toBeDefined();
    await waitFor(() => expect(history.location.pathname).toBe("/p/p1/goals"));
  });

  it("refusal (409 active goal, or other): `bad` toast, the page stays", async () => {
    const { deleteGoal, history } = mount(
      goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }),
    );
    deleteGoal.mockRejectedValue(new Error("this goal is active: stop it first"));

    fireEvent.click(await deleteButton());
    fireEvent.click(await screen.findByRole("button", { name: /^Confirm/ }));

    expect(await screen.findByText(GOAL_TEXT.page.deleteRefused)).toBeDefined();
    expect(await screen.findByText("this goal is active: stop it first")).toBeDefined();
    expect(history.location.pathname).toBe("/goals/g1");
  });
});

// Goal editing (03/09). A `draft` could only be driven by curl: name, request and rails had no gesture
// on screen. These tests pin the server's TWO status rules (goal-edit.ts), brief only in `draft`,
// rails until the goal ends, since they decide what the page offers.
const briefButton = () => screen.findByRole("button", { name: GOAL_TEXT.edit.brief });
const railsButton = () => screen.findByRole("button", { name: GOAL_TEXT.edit.rails });
const saveButton = () => screen.findByRole("button", { name: GOAL_TEXT.edit.save });
/** A `<Field>` appends the required badge after its label, so a PREFIX is matched. The label is
 *  escaped, or "Budget $" would end with an end-of-string anchor. */
const field = (label: string) =>
  screen.getByLabelText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

describe("GoalPage: a `draft` says it awaits approval", () => {
  it("the banner names the wait AND what will lift it", async () => {
    mount(goal({ status: GOAL_STATUS.draft }));
    expect(await screen.findByText(GOAL_TEXT.page.draftPending)).toBeDefined();
    expect(screen.getByText(GOAL_TEXT.page.draftPendingWhy)).toBeDefined();
  });

  it("an `active` goal does not show it: it runs, it waits for nothing", async () => {
    mount(goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }));
    await screen.findByText("Harden the payment funnel");
    expect(screen.queryByText(GOAL_TEXT.page.draftPending)).toBeNull();
  });
});

describe("GoalPage: editing the brief (draft only)", () => {
  it("the gesture exists ONLY on a `draft`: after approval the request is already in the loop", async () => {
    mount(goal({ status: GOAL_STATUS.draft }));
    expect(await briefButton()).toBeDefined();

    cleanup();
    mount(goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z" }));
    await screen.findByText("Harden the payment funnel");
    expect(screen.queryByRole("button", { name: GOAL_TEXT.edit.brief })).toBeNull();
  });

  it("sends the PATCH with the edited fields, then invalidates the goal query (the server regenerates the DoD)", async () => {
    const { editGoal } = mount(goal({ status: GOAL_STATUS.draft }));

    fireEvent.click(await briefButton());
    fireEvent.change(field(GOAL_TEXT.composer.request), {
      target: { value: "No ghost order, even after a PSP timeout." },
    });
    fireEvent.click(await saveButton());

    await waitFor(() =>
      expect(editGoal).toHaveBeenCalledWith("g1", {
        name: "Harden the payment funnel",
        request: "No ghost order, even after a PSP timeout.",
      }),
    );
    // Invalidation refetches: without it the screen would keep the OLD request's DoD above the new one.
    await waitFor(() =>
      expect(vi.mocked(goalsApi.goal).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("DoD regeneration failed: the server `warning` is relayed, the edit holds", async () => {
    const { editGoal } = mount(goal({ status: GOAL_STATUS.draft }));
    editGoal.mockResolvedValueOnce({
      ok: true,
      goal: goal(),
      changed: ["request"],
      dod: [],
      plan: [],
      warning: "request saved, but the DoD could not be regenerated: model unavailable (529)",
    });

    fireEvent.click(await briefButton());
    fireEvent.change(field(GOAL_TEXT.composer.request), {
      target: { value: "Another request." },
    });
    fireEvent.click(await saveButton());

    expect(await screen.findByText(GOAL_TEXT.edit.dodWarning)).toBeDefined();
    expect(await screen.findByText(/model unavailable \(529\)/)).toBeDefined();
  });
});

describe("GoalPage: editing rails (until the goal ends)", () => {
  it.each([GOAL_STATUS.draft, GOAL_STATUS.active, GOAL_STATUS.paused])(
    'the gesture exists on a "%s" goal',
    async (status) => {
      mount(goal({ status, startedAt: "2026-09-01T09:00:00.000Z" }));
      expect(await railsButton()).toBeDefined();
    },
  );

  it.each([
    GOAL_STATUS.completed,
    GOAL_STATUS.stoppedBudget,
    GOAL_STATUS.failed,
    GOAL_STATUS.cancelled,
  ])(
    'it disappears on a finished goal ("%s"): raising a stopped goal\'s budget does not restart it',
    async (status) => {
      mount(
        goal({
          status,
          startedAt: "2026-09-01T09:00:00.000Z",
          endedAt: "2026-09-02T09:00:00.000Z",
        }),
      );
      await screen.findByText("Harden the payment funnel");
      expect(screen.queryByRole("button", { name: GOAL_TEXT.edit.rails })).toBeNull();
    },
  );

  it('an `active` goal sends its three rails; an empty field means "no cap"', async () => {
    const { editGoal } = mount(
      goal({
        status: GOAL_STATUS.active,
        startedAt: "2026-09-01T09:00:00.000Z",
        budgetUsd: 25,
        maxDurationMs: 1_800_000,
        maxNoProgress: 3,
      }),
    );

    fireEvent.click(await railsButton());
    fireEvent.change(field(GOAL_TEXT.composer.budget), { target: { value: "60" } });
    fireEvent.change(field(GOAL_TEXT.edit.noProgress), { target: { value: "5" } });
    fireEvent.click(await saveButton());

    await waitFor(() =>
      expect(editGoal).toHaveBeenCalledWith("g1", {
        budgetUsd: 60,
        maxHours: 0.5,
        maxNoProgress: 5,
      }),
    );
  });

  it("non-numeric input is NOT sent: the reason reads, the button does nothing", async () => {
    const { editGoal } = mount(
      goal({ status: GOAL_STATUS.active, startedAt: "2026-09-01T09:00:00.000Z", budgetUsd: 25 }),
    );

    fireEvent.click(await railsButton());
    fireEvent.change(field(GOAL_TEXT.composer.budget), { target: { value: "60$" } });

    expect(await screen.findByText(GOAL_TEXT.edit.badNumber)).toBeDefined();
    fireEvent.click(await saveButton());
    expect(editGoal).not.toHaveBeenCalled();
  });

  it("the server refusal is relayed VERBATIM in a toast, no paraphrase", async () => {
    const refusal =
      'this goal is "completed": its rails no longer move. Raising a stopped goal\'s budget does not restart it; only a "paused" goal resumes.';
    const { editGoal } = mount(
      goal({ status: GOAL_STATUS.paused, startedAt: "2026-09-01T09:00:00.000Z" }),
    );
    editGoal.mockRejectedValueOnce(new Error(refusal));

    fireEvent.click(await railsButton());
    fireEvent.change(field(GOAL_TEXT.composer.budget), { target: { value: "60" } });
    fireEvent.click(await saveButton());

    expect(await screen.findByText(GOAL_TEXT.edit.refused)).toBeDefined();
    expect(await screen.findByText(refusal)).toBeDefined();
  });
});

describe("GoalPage: an empty DoD on a `draft` says why", () => {
  it("the reason stays on screen (the creation toast is gone) with the recovery next to it", async () => {
    const { regenerateGoal } = mount(goal({ status: GOAL_STATUS.draft, dod: [] }));

    expect(await screen.findByText(GOAL_TEXT.page.dodEmpty)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: GOAL_TEXT.page.regenerate }));
    await waitFor(() => expect(regenerateGoal).toHaveBeenCalledWith("g1"));
  });

  it("a filled DoD shows no alert", async () => {
    mount(goal({ status: GOAL_STATUS.draft }));
    await screen.findByLabelText(GOAL_TEXT.composer.criterion(1));
    expect(screen.queryByText(GOAL_TEXT.page.dodEmpty)).toBeNull();
  });
});
