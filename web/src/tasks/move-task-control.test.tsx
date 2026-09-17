// The move control's labels come from the catalog, not literals. `TASK_PAGE_TEXT.move` existed since
// 27/08 while the JSX rewrote the same strings by hand: they had not diverged, but a label fix made
// in the right place would have changed nothing on screen. Assertions read the catalog, so they
// break as soon as the JSX goes back to a literal and the catalog moves.
//
// Since 04/09 the control is an icon opening a MENU: the trigger carries `field`, entries carry
// `confirm(destination)`, and picking an entry writes (a menu click is deliberate, unlike a select
// `onChange`).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tasksApi, type Task } from "../api/tasks.js";
import { MoveTaskControl } from "./move-task-control.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const T = TASK_PAGE_TEXT.move;

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.doing,
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
  branch: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  createdAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-28T09:00:00.000Z",
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const control = () =>
  render(<MoveTaskControl task={task()} onMoved={() => {}} onError={() => {}} />);

/** Opens the menu, then picks "Review". */
const pickReview = () => {
  fireEvent.click(screen.getByRole("button", { name: T.field }));
  fireEvent.click(screen.getByRole("menuitem", { name: T.confirm(T.targets.review) }));
};

describe("MoveTaskControl: an icon, a menu, the labels of TASK_PAGE_TEXT.move", () => {
  it("the trigger carries `field` and writes nothing until a choice is made", () => {
    const spy = vi.spyOn(tasksApi, "setTaskStatus").mockResolvedValue({} as never);
    control();
    fireEvent.click(screen.getByRole("button", { name: T.field }));
    expect(screen.getByRole("menu", { name: T.field })).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("each entry names its DESTINATION through `confirm`, and picking it writes that status", () => {
    const spy = vi.spyOn(tasksApi, "setTaskStatus").mockResolvedValue({} as never);
    control();
    pickReview();
    expect(spy).toHaveBeenCalledWith("t-1", TASK_STATUS.review);
  });

  it("while writing, the wait is named by `saving`", () => {
    vi.spyOn(tasksApi, "setTaskStatus").mockImplementation(() => new Promise(() => {}));
    control();
    pickReview();
    expect(screen.getByRole("status").textContent).toBe(T.saving);
  });
});
