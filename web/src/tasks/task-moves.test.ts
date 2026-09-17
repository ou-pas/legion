// What the move control may offer. The rule is SERVER side; here we check the screen offers nothing
// the server would refuse. A button returning a 409 is worse than a missing one: it looks broken.
import { describe, expect, it } from "vitest";
import { allowedMove, moveOptions } from "./task-moves.js";
import { TASK_STATUS } from "../api/tasks.js";

describe("allowedMove", () => {
  it("only postpones what has not started", () => {
    expect(allowedMove(TASK_STATUS.todo, TASK_STATUS.later)).toBe(true);
    for (const from of [TASK_STATUS.doing, TASK_STATUS.review, TASK_STATUS.done] as const) {
      expect(allowedMove(from, TASK_STATUS.later)).toBe(false);
    }
  });

  it('only leaves "later" towards the queue', () => {
    expect(allowedMove(TASK_STATUS.later, TASK_STATUS.todo)).toBe(true);
    for (const to of [TASK_STATUS.doing, TASK_STATUS.review, TASK_STATUS.done] as const) {
      expect(allowedMove(TASK_STATUS.later, to)).toBe(false);
    }
  });

  it("lets the rest through", () => {
    expect(allowedMove(TASK_STATUS.doing, TASK_STATUS.review)).toBe(true);
    expect(allowedMove(TASK_STATUS.review, TASK_STATUS.done)).toBe(true);
    expect(allowedMove(TASK_STATUS.done, TASK_STATUS.todo)).toBe(true);
  });
});

describe("moveOptions", () => {
  it("never offers the current destination", () => {
    for (const from of [
      TASK_STATUS.later,
      TASK_STATUS.todo,
      TASK_STATUS.doing,
      TASK_STATUS.review,
      TASK_STATUS.done,
    ] as const) {
      expect(moveOptions(from).map(([s]) => s)).not.toContain(from);
    }
  });

  it('from "later", the only exit is the queue', () => {
    expect(moveOptions(TASK_STATUS.later).map(([s]) => s)).toEqual([TASK_STATUS.todo]);
  });

  it('from "doing", postponing is no longer possible', () => {
    expect(moveOptions(TASK_STATUS.doing).map(([s]) => s)).toEqual([
      TASK_STATUS.todo,
      TASK_STATUS.review,
      TASK_STATUS.done,
    ]);
  });

  it("carries the column label, not the enum value", () => {
    expect(moveOptions(TASK_STATUS.todo).map(([, label]) => label)).toEqual([
      "Later",
      "Review",
      "Done",
    ]);
  });
});
