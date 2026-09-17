// The close button of a deep page: resume the thread when there is one, fall back otherwise, never
// the reverse, and never both gestures at once (no second button).
//
// The test mounts a real router on a prefilled memory history (same pattern as
// `tasks/use-task-view.test.tsx`) rather than clicking a link to get there: an earlier entry in
// `initialEntries` simulates exactly what TanStack Router sees after internal navigation
// (`__TSR_index !== 0`), without depending on the app's real route tree that `Link`/`useNavigate`
// type-check.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useBackOrFallback } from "./use-back-or-fallback.js";

afterEach(cleanup);

// The page's fallback, set apart so the test component stays readable.
let fallbackCalls = 0;

function CrossButton() {
  const close = useBackOrFallback(() => {
    fallbackCalls++;
  });
  return (
    <button type="button" onClick={close}>
      close
    </button>
  );
}

/** Stability probe: it re-renders itself several times, rewriting its fallback each time, and keeps
 *  the identity of the returned gesture. It lives in the router like the others: `useRouter()` does
 *  not exist outside. */
const probeGestures = new Set<() => void>();

function ProbeButton() {
  const [tick, setTick] = useState(1);
  const close = useBackOrFallback(() => {
    fallbackCalls += tick;
  });
  probeGestures.add(close);
  return (
    <>
      <button type="button" onClick={close}>
        close
      </button>
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        rerender
      </button>
    </>
  );
}

const rootRoute = createRootRoute();
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board",
  component: () => "board",
});
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/task",
  component: CrossButton,
});

const probeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/probe",
  component: ProbeButton,
});

function mount(initialEntries: string[]) {
  const history = createMemoryHistory({ initialEntries });
  const router = createRouter({
    routeTree: rootRoute.addChildren([boardRoute, taskRoute, probeRoute]),
    history,
  });
  render(<RouterProvider router={router} />);
  return history;
}

/** On a direct arrival: the close button then goes through the fallback, which the test observes. */
function mountProbe() {
  probeGestures.clear();
  return mount(["/probe"]);
}

describe("useBackOrFallback", () => {
  beforeEach(() => {
    fallbackCalls = 0;
  });

  it("direct arrival on the page (no internal history): the fallback, not a back() into the void", async () => {
    const history = mount(["/task"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "close" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(fallbackCalls).toBe(1);
    expect(history.location.pathname).toBe("/task"); // no ghost navigation
  });

  it("coming from the board: the close button resumes the thread, not the fallback", async () => {
    const history = mount(["/board", "/task"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "close" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(history.location.pathname).toBe("/board"));
    expect(fallbackCalls).toBe(0);
  });

  // 15/09: the gesture is passed as a prop by its three callers, one of them memoised
  // (`QuestionForm`). A gesture recreated each render would make that `memo` decorative with nothing
  // failing, the kind of regression only a flickering screen reveals.
  it("returns the same gesture across renders, rewritten fallback included", async () => {
    mountProbe();
    await waitFor(() => expect(screen.getByRole("button", { name: "close" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    expect(probeGestures.size).toBe(1);

    // And it is the latest fallback that runs, not the one frozen at first render: the probe is on
    // a direct arrival, so the close button goes through the fallback.
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(fallbackCalls).toBe(3));
  });
});
