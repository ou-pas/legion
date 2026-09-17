// The save key on the task page (D1, 15/09): same data as the composer's brief (task.description),
// so same gesture, except that on the page ⌘/Ctrl+Enter SAVES and runs nothing.
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
import { tasksApi } from "../api/tasks.js";
import { qk } from "../queries.js";
import { ToastProvider } from "../ui/toast.js";
import { demoTask } from "./task-fixture.js";
import { TaskShellProvider, type TaskShellState } from "./TaskPage.js";
import { BriefScreen } from "./task-screens.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};

/** Mounts `BriefScreen` alone, outside the shell: same pattern as `view()` in
 *  task-screens.stories.tsx, reduced to what this test needs. */
function mount(over: Partial<TaskShellState> = {}) {
  const setTaskDescription = vi
    .spyOn(tasksApi, "setTaskDescription")
    .mockImplementation((id, description) => Promise.resolve({ ...demoTask({ id, description }) }));

  const state: TaskShellState = {
    task: demoTask(),
    agent: undefined,
    session: undefined,
    active: false,
    events: [],
    stream: "live",
    reconnect: noop,
    report: { text: "", available: false },
    interview: false,
    segments: [],
    hasPr: false,
    refresh: noop,
    ...over,
  };

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.taskLinks(state.task.id), { parent: null, children: [] });

  const rootRoute = createRootRoute();
  const here = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <TaskShellProvider value={state}>
            <BriefScreen />
          </TaskShellProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([here]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return { setTaskDescription };
}

const WAIT = { timeout: 5_000 };

describe("BriefScreen: the save key", () => {
  it("⌘+Enter saves; plain Enter does nothing", async () => {
    const { setTaskDescription } = mount({ task: demoTask({ description: "Initial brief." }) });

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }, WAIT));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "Corrected brief." } });

    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    await waitFor(() => expect(setTaskDescription).toHaveBeenCalledTimes(1), WAIT);
    expect(setTaskDescription).toHaveBeenCalledWith("t-1", "Corrected brief.");
  });

  it("two ⌘+Enter in a row: the `saving` guard sends a single PATCH", async () => {
    const { setTaskDescription } = mount({ task: demoTask({ description: "Initial brief." }) });

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }, WAIT));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "Corrected brief." } });

    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    await waitFor(() => expect(setTaskDescription).toHaveBeenCalled(), WAIT);
    expect(setTaskDescription).toHaveBeenCalledTimes(1);
  });

  it('shows the shortcut on "Save"', async () => {
    mount({ task: demoTask({ description: "Initial brief." }) });

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }, WAIT));
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.querySelector(".ui-btn-shortcut")).not.toBeNull();
  });
});
