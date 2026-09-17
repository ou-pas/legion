// The shortcut hint on "Run" (14/09, decision D1, eighth site, the one that never had it).
// `use-launch-shortcut.ts` already bound the key without announcing it; this test pins the chip ON
// the button next to the label, not a separate caption nor hardcoded text (see
// `ui/submit-shortcut.tsx`).
//
// The compact breakpoint (15/09): what `measure-compact.mjs` proves in a real Chrome (no target under
// 44px, a single row) jsdom cannot compute, it does no layout. What jsdom CAN prove these tests
// prove: under 640px text buttons lose their label but keep their accessible name, the "…" menu
// spells labels out, and the close cross is gone everywhere.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLEXITY, PRIORITY, TASK_STATUS, type Task } from "../api/tasks.js";
import { type Session } from "../api/sessions.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { ENTER, MOD } from "../ui/platform.js";
import { TaskActionsBar, type TaskActionsBarProps } from "./task-actions-bar.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import type { TaskActions } from "./use-task-actions.js";

afterEach(cleanup);

/** `matchMedia` does not exist in jsdom (same trick as `ui/theme.test.tsx`): the component only
 *  listens to one query here (`COMPACT_QUERY`), so a fake global ignoring it and always answering
 *  `matches` is enough. */
function fakeMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// Wide screen by default for every test of this file: it is `useMediaQuery`'s own server rendering
// assumption (third argument of `useSyncExternalStore`), so the least surprising default until a
// test explicitly says "under 640px".
beforeEach(() => fakeMatchMedia(false));

const AT = "2026-09-14T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.todo,
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
  branch: null,
  createdAt: AT,
  updatedAt: AT,
  boardOrder: 1,
  editable: true,
  briefEditable: true,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const session: Session = {
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "opus",
  status: "running",
  costUsd: 0.1,
  resumeCount: 0,
  startedAt: AT,
  endedAt: null,
  endReason: null,
};

const noop = () => {};
const resolved = () => Promise.resolve();
const actions: TaskActions = {
  run: resolved,
  relaunch: resolved,
  approve: resolved,
  pause: resolved,
  stop: resolved,
  remove: resolved,
  copyTrace: noop,
  copyResume: resolved,
  approveLot: noop,
  discuss: noop,
  pending: { lot: false, discuss: false, run: false },
};

const bar = (over: Partial<TaskActionsBarProps> = {}) => (
  <TaskActionsBar
    task={over.task ?? task()}
    session={over.session}
    active={over.active ?? false}
    sessionCount={over.sessionCount ?? 0}
    unmetPrereq={over.unmetPrereq ?? null}
    eventCount={over.eventCount ?? 0}
    pendingPr={over.pendingPr ?? false}
    canDiscuss={over.canDiscuss ?? false}
    inspectorOpen={over.inspectorOpen ?? true}
    actions={over.actions ?? actions}
    onToggleInspector={noop}
    onOpenPr={noop}
    onMoved={noop}
    onMoveError={noop}
  />
);

describe('TaskActionsBar: "Run" carries the shortcut hint', () => {
  it("shows ⌘/Ctrl+↵ as a chip next to the label, not as a separate caption", () => {
    render(bar());
    const button = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    expect(button.querySelector(".ui-btn-shortcut")?.textContent).toBe(MOD + ENTER);
  });

  it('does not appear when "Run" is not offered: a blocked task has no ghost shortcut', () => {
    render(
      bar({ task: task({ blockedBy: [{ id: "t-2", name: "Other", status: TASK_STATUS.doing }] }) }),
    );
    expect(screen.queryByRole("button", { name: TASK_PAGE_TEXT.actions.run })).toBeNull();
  });
});

describe('TaskActionsBar: "Run" shows its wait (16/09, spec 2jan8IZn61)', () => {
  it("desktop: aria-busy and disabled when pending.run is true", () => {
    render(bar({ actions: { ...actions, pending: { ...actions.pending, run: true } } }));
    const button = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("compact (IconBtn): same state, same pending.run prop", () => {
    fakeMatchMedia(true);
    render(bar({ actions: { ...actions, pending: { ...actions.pending, run: true } } }));
    const button = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TaskActionsBar: the close cross is gone (decision 3, 15/09)", () => {
  it('no "Close" button, on a wide screen or under 640px', () => {
    // A literal, not `TASK_PAGE_TEXT.actions.close`: the key left the catalog with the button, which
    // is exactly what this test checks.
    render(bar());
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    cleanup();
    fakeMatchMedia(true);
    render(bar({ task: task({ status: TASK_STATUS.review }), sessionCount: 1 }));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("TaskActionsBar: under 640px (spec of 15/09)", () => {
  beforeEach(() => fakeMatchMedia(true));

  it('"Run" loses its visible label but keeps its accessible name', () => {
    render(bar());
    const button = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    expect(button.textContent).toBe("");
  });

  it('"Approve" names itself on first tap (ConfirmAction iconOnly), even without a missing prerequisite', () => {
    render(bar({ task: task({ status: TASK_STATUS.review }), sessionCount: 1 }));
    const button = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.approve });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.approve }).textContent).toBe(
      TASK_PAGE_TEXT.actions.approve,
    );
  });

  it('secondary icons go behind "…", with their labels spelled out', () => {
    render(bar({ session, eventCount: 3 }));
    expect(screen.queryByRole("button", { name: TASK_PAGE_TEXT.actions.resume })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    expect(
      within(menu).getByRole("menuitem", { name: TASK_PAGE_TEXT.actions.resume }),
    ).toBeDefined();
    expect(
      within(menu).getByRole("menuitem", { name: TASK_PAGE_TEXT.actions.copyTrace }),
    ).toBeDefined();
    expect(
      within(menu).getByRole("menuitem", {
        name: inspectorOpenLabel(true),
      }),
    ).toBeDefined();
  });

  it('"copy the trace" is ABSENT from the menu when the trace is empty, not greyed', () => {
    render(bar({ eventCount: 0 }));
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    expect(
      within(menu).queryByRole("menuitem", { name: TASK_PAGE_TEXT.actions.copyTrace }),
    ).toBeNull();
  });

  it('"delete" stays two-step, in place, inside the menu', () => {
    const remove = vi.fn();
    render(bar({ actions: { ...actions, remove }, sessionCount: 2 }));
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    const item = within(menu).getByRole("menuitem", { name: TASK_PAGE_TEXT.actions.delete });
    fireEvent.click(item);
    expect(remove).not.toHaveBeenCalled();
    expect(
      within(menu).getByRole("menuitem", { name: TASK_PAGE_TEXT.actions.confirmDelete(2) }),
    ).toBeDefined();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: TASK_PAGE_TEXT.actions.confirmDelete(2) }),
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('pause and stop stay out of the menu, next to "…": the "a session runs" state', () => {
    render(bar({ task: task({ status: TASK_STATUS.doing }), session, active: true }));
    expect(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.pause })).toBeDefined();
    expect(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.stop })).toBeDefined();
  });

  it('"move" has no trigger in the bar any more: its destinations are menu rows', () => {
    render(bar({ task: task({ status: TASK_STATUS.todo }) }));
    expect(screen.queryByRole("button", { name: TASK_PAGE_TEXT.move.field })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    expect(
      within(menu).getByRole("menuitem", {
        name: TASK_PAGE_TEXT.move.confirm(TASK_PAGE_TEXT.move.targets.review),
      }),
    ).toBeDefined();
  });

  it("the compact menu's menuitem/separator sequence follows exactly the three groups (decision 3, 16/09)", () => {
    render(
      bar({ task: task({ status: TASK_STATUS.todo }), session, eventCount: 3, sessionCount: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    const rows = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((n) =>
      n.getAttribute("role") === "separator" ? "separator" : n.textContent,
    );
    expect(rows).toEqual([
      TASK_PAGE_TEXT.actions.resume,
      TASK_PAGE_TEXT.move.confirm(TASK_PAGE_TEXT.move.targets.later),
      TASK_PAGE_TEXT.move.confirm(TASK_PAGE_TEXT.move.targets.review),
      TASK_PAGE_TEXT.move.confirm(TASK_PAGE_TEXT.move.targets.done),
      "separator",
      TASK_PAGE_TEXT.actions.copyTrace,
      inspectorOpenLabel(true),
      "separator",
      TASK_PAGE_TEXT.actions.delete,
    ]);
  });

  it("without a session nor a possible destination (active task), the menu does not open on a separator", () => {
    render(bar({ task: task({ status: TASK_STATUS.doing }), active: true, eventCount: 0 }));
    fireEvent.click(screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.more }));
    const menu = screen.getByRole("menu", { name: TASK_PAGE_TEXT.actions.more });
    const rows = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')];
    expect(rows[0]?.getAttribute("role")).not.toBe("separator");
    expect(within(menu).queryAllByRole("separator")).toHaveLength(0);
  });
});

describe('TaskActionsBar: Run before Discuss (decision 1, "launch first" spec, 16/09)', () => {
  it('"Run" precedes "Discuss" in the DOM, on a wide screen and under 640px', () => {
    const runnableTask = task({ status: TASK_STATUS.todo });

    render(bar({ task: runnableTask, canDiscuss: true }));
    const run = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    const discuss = screen.getByRole("button", { name: INTERVIEW_TEXT.start.takeOver });
    expect(run.compareDocumentPosition(discuss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    cleanup();
    fakeMatchMedia(true);
    render(bar({ task: runnableTask, canDiscuss: true }));
    const runCompact = screen.getByRole("button", { name: TASK_PAGE_TEXT.actions.run });
    const discussCompact = screen.getByRole("button", { name: INTERVIEW_TEXT.start.takeOver });
    expect(
      runCompact.compareDocumentPosition(discussCompact) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

function inspectorOpenLabel(open: boolean) {
  return open ? TASK_PAGE_TEXT.inspector.close : TASK_PAGE_TEXT.inspector.open;
}
