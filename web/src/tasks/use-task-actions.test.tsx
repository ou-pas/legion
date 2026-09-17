// A task's gestures: the right call, and the right keys invalidated.
//
// What this test catches and nothing else saw: a gesture calling the server without refreshing the
// screen. The symptom is a task staying "doing" after a successful stop until the next poll (paused
// out of focus, so sometimes never). No error, no broken type, and it reads as a slow server.
//
// The QueryClient is REAL: `useInvalidateLive` marks keys stale, which is cache STATE, not a method
// to spy on. So data is seeded under each prefix, the gesture played, and the query state reread. A
// mocked client would prove it is called, not that anything happens.
//
// The hook is mounted BY A ROUTER, like the shell: it calls `useNavigate` (delete goes back to the
// board), which throws outside a router. Same setup as `use-task-view.test.tsx`, module state
// included: a component mounted by the router receives nothing from outside.
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Agent } from "../api/agents.js";
import { REPO_ACCESS } from "../api/agents.js";
import { sessionsApi, type Session } from "../api/sessions.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { COMPLEXITY, PRIORITY, TASK_STATUS } from "../api/tasks.js";
import { qk } from "../queries.js";
import { ToastProvider } from "../ui/toast.js";
import { useTaskActions, type TaskActions, type TaskActionsInput } from "./use-task-actions.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const AT = "2026-09-06T09:00:00.000Z";

const task: Task = {
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.review,
  settledOutcome: null,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  branch: "feature/env",
  createdAt: AT,
  updatedAt: AT,
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
};

const session: Session = {
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "opus",
  status: "running",
  costUsd: 0.42,
  resumeCount: 0,
  startedAt: AT,
  endedAt: null,
  endReason: null,
};

const agent: Agent = {
  id: "a-1",
  projectId: "p-1",
  name: "builder",
  title: "Developer",
  model: null,
  rolePrompt: "",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: "[]",
  repoAccess: REPO_ACCESS.none,
  runnerPreference: null,
  inboxAccess: false,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: "[]",
};

/** What the router-mounted component receives, and what it hands back to the test. */
let input: TaskActionsInput;
const seen: { actions: TaskActions | null } = { actions: null };

function Probe() {
  const actions = useTaskActions(input);
  // In an EFFECT and not during render: writing outside the component while rendering is forbidden by
  // `react(immutability)`, rightly, being an invisible side effect. `act()` flushes effects, so the
  // test always reads the render that just happened.
  useEffect(() => {
    seen.actions = actions;
  });
  return null;
}

const rootRoute = createRootRoute({ component: Probe });

/** The three prefixes `useInvalidateLive` touches, seeded fresh. `staleTime: Infinity`: without it
 *  data is stale from the start, and the assertion would pass proving nothing. */
function mount(over: Partial<TaskActionsInput> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  qc.setQueryData(qk.tasks, { tasks: [task], sessions: [session] });
  qc.setQueryData(qk.inbox, []);
  qc.setQueryData(qk.artifacts("t-1"), []);

  input = {
    taskId: "t-1",
    task,
    agent,
    session,
    events: [],
    agents: [agent],
    refetchLot: () => {},
    ...over,
  };
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const actions = async (): Promise<TaskActions> => {
  await waitFor(() => expect(seen.actions).not.toBeNull());
  return seen.actions!;
};

const invalidated = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryState(key)?.isInvalidated === true;

/** The three live keys must ALL be marked stale: the task list (board and shell), the inbox (a pause
 *  files a question there) and the task's artifacts. */
async function expectLiveInvalidated(qc: QueryClient) {
  await waitFor(() => {
    expect(invalidated(qc, qk.tasks)).toBe(true);
    expect(invalidated(qc, qk.inbox)).toBe(true);
    expect(invalidated(qc, qk.artifacts("t-1"))).toBe(true);
  });
}

describe("useTaskActions: each gesture calls the right endpoint and refreshes the screen", () => {
  it("run runs the task", async () => {
    const run = vi.spyOn(tasksApi, "runTask").mockResolvedValue({ sessionId: "s-2" });
    const qc = mount();

    // Since 16/09 `run` carries its promise until the following invalidation (D2), so `act()` must be
    // AWAITED, or the chain settles DURING the next test (React only flushes what `act()` sees) and
    // invalidates the WRONG QueryClient.
    await act(async () => {
      await (await actions()).run();
    });

    expect(run).toHaveBeenCalledWith("t-1");
    await expectLiveInvalidated(qc);
  });

  it("approve moves the task to `done`", async () => {
    const set = vi.spyOn(tasksApi, "setTaskStatus").mockResolvedValue(task);
    const qc = mount();

    await act(async () => {
      await (await actions()).approve();
    });

    expect(set).toHaveBeenCalledWith("t-1", TASK_STATUS.done);
    await expectLiveInvalidated(qc);
  });

  it("pause asks THE session for a soft stop, not the task", async () => {
    const pause = vi.spyOn(sessionsApi, "pauseSession").mockResolvedValue({ ok: true });
    const qc = mount();

    await act(async () => {
      await (await actions()).pause();
    });

    expect(pause).toHaveBeenCalledWith("s-1");
    await expectLiveInvalidated(qc);
  });

  it("stop kills the session", async () => {
    const stop = vi.spyOn(sessionsApi, "stopSession").mockResolvedValue({ ok: true });
    const qc = mount();

    await act(async () => {
      await (await actions()).stop();
    });

    expect(stop).toHaveBeenCalledWith("s-1");
    await expectLiveInvalidated(qc);
  });

  it("remove deletes the task", async () => {
    const del = vi.spyOn(tasksApi, "deleteTask").mockResolvedValue({
      ok: true,
      deleted: "Environments screen",
      footprint: { sessions: 2, events: 140, inbox: 1, activity: 3 },
    });
    mount();

    await act(async () => {
      await (await actions()).remove();
    });

    expect(del).toHaveBeenCalledWith("t-1");
  });

  it("approveLot disarms its control during the call, then refetches the batch", async () => {
    const approve = vi
      .spyOn(tasksApi, "approveLot")
      .mockResolvedValue({ created: ["t-2", "t-3", "t-4"] });
    const refetchLot = vi.fn();
    const qc = mount({ refetchLot });

    act((await actions()).approveLot);
    expect(seen.actions?.pending.lot).toBe(true);

    expect(approve).toHaveBeenCalledWith("t-1");
    await waitFor(() => expect(seen.actions?.pending.lot).toBe(false));
    // A refusal comes back with ALL its faults: the REFETCHED batch carries them, not a toast.
    expect(refetchLot).toHaveBeenCalled();
    await expectLiveInvalidated(qc);
  });

  it("a refused batch still refetches, and does not leave the control armed forever", async () => {
    vi.spyOn(tasksApi, "approveLot").mockRejectedValue(new Error("three slices without criteria"));
    const refetchLot = vi.fn();
    mount({ refetchLot });

    act((await actions()).approveLot);

    await waitFor(() => expect(seen.actions?.pending.lot).toBe(false));
    expect(refetchLot).toHaveBeenCalled();
  });

  it("without a session, pause and stop do not go out: there is nothing to stop", async () => {
    const pause = vi.spyOn(sessionsApi, "pauseSession").mockResolvedValue({ ok: true });
    const stop = vi.spyOn(sessionsApi, "stopSession").mockResolvedValue({ ok: true });
    mount({ session: undefined });

    const a = await actions();
    act(a.pause);
    act(a.stop);

    expect(pause).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("without a loaded task, no gesture goes out", async () => {
    const run = vi.spyOn(tasksApi, "runTask").mockResolvedValue({ sessionId: "s-2" });
    const del = vi.spyOn(tasksApi, "deleteTask");
    mount({ task: undefined });

    const a = await actions();
    act(a.run);
    act(a.remove);

    expect(run).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
