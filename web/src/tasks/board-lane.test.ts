// The remembered lane. Two facts, and the second breaks silently: a value read back from storage is
// not trusted, it may date from a version where the lane had another name, or have been written by
// hand. Without a filter the board would render an empty column with nothing saying why.
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LANE, readLane, writeLane } from "./board-lane.js";

beforeEach(() => localStorage.clear());

describe("readLane", () => {
  it("returns the default when nothing was remembered", () => {
    expect(readLane("p1")).toBe(DEFAULT_LANE);
  });

  it("returns what was written, project by project", () => {
    writeLane("p1", "todo");
    writeLane("p2", "review");
    expect(readLane("p1")).toBe("todo");
    expect(readLane("p2")).toBe("review");
  });

  it("refuses a value that is not a lane", () => {
    localStorage.setItem("legion.board.lane.p1", "archived");
    expect(readLane("p1")).toBe(DEFAULT_LANE);
  });

  // Without a project there is nothing to remember: no read, no write, and above all no key shared
  // by every project, which would be the defect being fixed, only worse.
  it("remembers nothing without a project", () => {
    writeLane(null, "todo");
    expect(localStorage.length).toBe(0);
    expect(readLane(null)).toBe(DEFAULT_LANE);
  });
});
