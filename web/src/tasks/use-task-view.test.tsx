// The address without a view, and what the stream changes afterwards (slice nav/17, AC#2).
//
// `effectiveView` is tested separately, and alone it proves nothing of what matters here: that a
// task opened WITHOUT a view lands somewhere, and at the RIGHT place, although the deciding data (a
// report exists) is not there at first render. Same lesson as slice nav/06 on `?vue=`: a pure
// function test would say it returns "timeline", not that the browser goes there.
//
// So the test mounts a REAL router on a memory history and watches the URL. `replace` only shows on
// a history stack: a spy on `navigate` would prove the option was passed, not that it does what we
// believe.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { TASK_VIEWS, type TaskView } from "./task-views.js";
import { useResolveTaskView } from "./use-task-view.js";

// `globals` is false in the config, so testing-library's automatic cleanup is not wired, and two
// mounts ended up in the same document.
afterEach(cleanup);

type Ctx = { enabled: boolean; interview: boolean; hasReport: boolean; hasSession: boolean };
/** What the shell knows at first render, and what the stream will teach it next. Module state
 *  because the shell is mounted BY the router: nothing is passed from outside. */
let ctx: Ctx = { enabled: true, interview: false, hasReport: false, hasSession: false };
let later: Partial<Ctx> = {};

function Shell() {
  // The button plays the SSE stream's arrival: it changes nothing in the URL, it changes what the
  // page KNOWS. Exactly the real sequence, where the trace arrives after the first render.
  const [arrived, setArrived] = useState(false);
  useResolveTaskView(arrived ? { ...ctx, ...later } : ctx);
  return (
    <>
      <button type="button" onClick={() => setArrived(true)}>
        stream
      </button>
      <Link to="/p/$projectId/tasks/$taskId/timeline" params={{ projectId: "p1", taskId: "abc" }}>
        trace
      </Link>
      {/* The DETOUR. A third view is needed to reproduce the rail defect: two are not enough, since it
          comes from a round trip. */}
      <Link to="/p/$projectId/tasks/$taskId/notes" params={{ projectId: "p1", taskId: "abc" }}>
        notes
      </Link>
      <Link to="/p/$projectId/tasks/$taskId/report" params={{ projectId: "p1", taskId: "abc" }}>
        report
      </Link>
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute();
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/tasks/$taskId",
  component: Shell,
});
const indexRoute = createRoute({
  getParentRoute: () => taskRoute,
  path: "/",
  component: () => null,
});
const viewRoutes = TASK_VIEWS.map((v) =>
  createRoute({ getParentRoute: () => taskRoute, path: v, component: () => null }),
);

function mount(url: string, state: Partial<Ctx> = {}, after: Partial<Ctx> = {}) {
  ctx = { enabled: true, interview: false, hasReport: false, hasSession: false, ...state };
  later = after;
  const history = createMemoryHistory({ initialEntries: ["/p/p1/tasks/abc/timeline", url] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([taskRoute.addChildren([indexRoute, ...viewRoutes])]),
    history,
  });
  render(<RouterProvider router={router} />);
  return { history, router };
}

const at = async (history: ReturnType<typeof createMemoryHistory>, pathname: string) =>
  waitFor(() => expect(history.location.pathname).toBe(pathname));

const stable = async (history: ReturnType<typeof createMemoryHistory>, pathname: string) => {
  await new Promise((r) => setTimeout(r, 30));
  expect(history.location.pathname).toBe(pathname);
};

const streamArrives = () => fireEvent.click(screen.getByRole("button", { name: "stream" }));

describe("the address without a view leads to the most useful view", () => {
  it("no session ever run: the brief, the contract one wants to read first", async () => {
    const { history } = mount("/p/p1/tasks/abc", { hasSession: false });
    await at(history, "/p/p1/tasks/abc/brief");
  });

  it("nothing special: the trace", async () => {
    const { history } = mount("/p/p1/tasks/abc", { hasSession: true });
    await at(history, "/p/p1/tasks/abc/timeline");
  });

  it("a report exists: it is what opens", async () => {
    // Choice C of 23/08: the page first answers "what happened?", the raw trace stays one click
    // away.
    const { history } = mount("/p/p1/tasks/abc", { hasReport: true, hasSession: true });
    await at(history, "/p/p1/tasks/abc/report");
  });

  it("an interview task: the thread, which IS the work", async () => {
    const { history } = mount("/p/p1/tasks/abc", {
      interview: true,
      hasReport: true,
      hasSession: true,
    });
    await at(history, "/p/p1/tasks/abc/interview");
  });

  it("resolution does NOT cost a history entry", async () => {
    // Without `replace`, opening a task would take two "back" presses to return to the board, the
    // first one going back forward.
    const { history } = mount("/p/p1/tasks/abc", { hasSession: true });
    await at(history, "/p/p1/tasks/abc/timeline");
    expect(history.length).toBe(2); // the starting entry, then the task: resolution adds nothing
    history.back();
    expect(history.location.pathname).toBe("/p/p1/tasks/abc/timeline");
  });

  it("no task behind the id: no address is built", async () => {
    // The page renders its absence. Building `/timeline` for a task that does not exist would add an
    // error to an error.
    const { history } = mount("/p/p1/tasks/abc", { enabled: false });
    await stable(history, "/p/p1/tasks/abc");
  });
});

// The case that breaks silently. `hasReport` derives from the SSE stream, arriving AFTER the first
// render: at resolution time it is false on EVERY task. A resolution that did not replay would pin
// the page on the trace before knowing a report exists, and nobody would see choice C is dead: the
// screen looks normal, it just always opens the wrong view.
describe("the first session run on a task never run", () => {
  it("the brief gives way to the trace it did not know about yet", async () => {
    const { history } = mount("/p/p1/tasks/abc", { hasSession: false }, { hasSession: true });
    await at(history, "/p/p1/tasks/abc/brief");
    streamArrives();
    await at(history, "/p/p1/tasks/abc/timeline");
    // Still no history entry: a correction is a correction, not one more step.
    expect(history.length).toBe(2);
  });

  it("a REQUESTED address is never corrected, even when the first session starts", async () => {
    // Opening a task on the brief through its address, then running the session, must not send
    // elsewhere: what the operator asked for is theirs.
    const { history } = mount("/p/p1/tasks/abc/brief", { hasSession: false }, { hasSession: true });
    await stable(history, "/p/p1/tasks/abc/brief");
    streamArrives();
    await stable(history, "/p/p1/tasks/abc/brief");
  });
});

describe("resolution takes back what it set, and nothing else", () => {
  it("the trace gives way to the report it did not know about yet", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, hasReport: false },
      { hasReport: true },
    );
    await at(history, "/p/p1/tasks/abc/timeline");
    streamArrives();
    await at(history, "/p/p1/tasks/abc/report");
    // Still no history entry: a correction is a correction, not one more step.
    expect(history.length).toBe(2);
  });

  it("a REQUESTED address is never corrected", async () => {
    // Opening a task on its notes through a pasted link, then seeing the stream arrive, must not send
    // elsewhere: what the operator asked for is theirs.
    const { history } = mount("/p/p1/tasks/abc/notes", { hasReport: false }, { hasReport: true });
    await stable(history, "/p/p1/tasks/abc/notes");
    streamArrives();
    await stable(history, "/p/p1/tasks/abc/notes");
  });

  // The view that stops existing underfoot (AC#2, second half). The SAME distinction settles it: what
  // the resolution set it takes back when the deciding data changes; what the operator asked for, it
  // does not, and the view then says what it lacks.
  it("the report we SET stops being one: back to the trace", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, hasReport: true },
      { hasReport: false },
    );
    await at(history, "/p/p1/tasks/abc/report");
    streamArrives(); // a session restarts: the summary is no longer one
    await at(history, "/p/p1/tasks/abc/timeline");
    expect(history.length).toBe(2);
  });

  it("the thread we SET stops being one: back to the default", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, interview: true },
      { interview: false, hasReport: true },
    );
    await at(history, "/p/p1/tasks/abc/interview");
    streamArrives();
    await at(history, "/p/p1/tasks/abc/report");
  });

  it("the report we ASKED for stays: the view says what is missing", async () => {
    // The "Report" rank is permanent. A click on it sending elsewhere is a broken rank: the validated
    // mock-up promises nothing moves under the cursor.
    const { history } = mount("/p/p1/tasks/abc/report", { hasReport: true }, { hasReport: false });
    await stable(history, "/p/p1/tasks/abc/report");
    streamArrives();
    await stable(history, "/p/p1/tasks/abc/report");
  });

  // The case that needed a detour to show (certification of 01/09). The neighbouring test covers a
  // requested view DIFFERENT from what the resolution set; this one covers the SAME one, taken back
  // after going through a third. The hook returned without updating `posed`, so coming back to that
  // view read as resolution-set, hence correctable: the rail's "Trace" rank landed on "Report", and
  // it took two clicks.
  it("the view SET at the start becomes requestable again after a detour", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, hasReport: false },
      { hasReport: true },
    );
    await at(history, "/p/p1/tasks/abc/timeline"); // the resolution SETS the trace
    fireEvent.click(screen.getByRole("link", { name: "notes" }));
    await at(history, "/p/p1/tasks/abc/notes");
    streamArrives(); // the session ends: a report exists
    await stable(history, "/p/p1/tasks/abc/notes");
    fireEvent.click(screen.getByRole("link", { name: "trace" }));
    await stable(history, "/p/p1/tasks/abc/timeline");
  });

  it("the mirror case: the SET report becomes requestable again after a detour", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, hasReport: true },
      { hasReport: false },
    );
    await at(history, "/p/p1/tasks/abc/report"); // the resolution SETS the report
    fireEvent.click(screen.getByRole("link", { name: "notes" }));
    await at(history, "/p/p1/tasks/abc/notes");
    streamArrives(); // a session restarts: the summary is no longer one
    await stable(history, "/p/p1/tasks/abc/notes");
    fireEvent.click(screen.getByRole("link", { name: "report" }));
    await stable(history, "/p/p1/tasks/abc/report");
  });

  it("a view chosen AFTER the correction takes over", async () => {
    const { history } = mount(
      "/p/p1/tasks/abc",
      { hasSession: true, hasReport: false },
      { hasReport: true },
    );
    await at(history, "/p/p1/tasks/abc/timeline");
    streamArrives();
    await at(history, "/p/p1/tasks/abc/report");
    fireEvent.click(screen.getByRole("link", { name: "trace" }));
    await at(history, "/p/p1/tasks/abc/timeline");
    // The correction does not replay behind the click: otherwise the "Trace" rank would be unusable
    // on any task with a report.
    await stable(history, "/p/p1/tasks/abc/timeline");
  });
});

describe("a view without content stays where it is", () => {
  it.each(["report", "interview", "criteria", "pr", "notes"] satisfies TaskView[])(
    "%s redirects nowhere",
    async (v) => {
      // Rail ranks are STATIC: a view without content SAYS so, it does not redirect. Redirecting would
      // be worse: "Report" and "Interview" are permanent ranks, and on most tasks a click on them
      // would do nothing visible.
      const { history } = mount(`/p/p1/tasks/abc/${v}`);
      await stable(history, `/p/p1/tasks/abc/${v}`);
    },
  );
});
