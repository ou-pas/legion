// A task's branch, and above all what it does with an UNREADABLE column.
//
// This was covered through the verdict, which showed the branch: an `externalRef` column holding
// something other than JSON threw DURING render and blanked the whole page, without a message. On
// 14/09 the branch left the banner for the "Runtime & context" panel, and coverage would have gone
// with it. So it lives HERE, on the function actually carrying the guard: three screens call it
// (the panel, the PR tab, the channel view), and only one of them was tested.
import { describe, expect, it } from "vitest";
import { taskBranch } from "./task-branch.js";

const task = (externalRef: string | null, branch: string | null) =>
  ({ externalRef, branch }) as Parameters<typeof taskBranch>[0];

describe("taskBranch", () => {
  it("NEVER throws on an unreadable external reference, and falls back on the column", () => {
    expect(taskBranch(task("not json", "chore/from-the-column"))).toBe("chore/from-the-column");
    expect(taskBranch(task("{", "chore/from-the-column"))).toBe("chore/from-the-column");
    expect(taskBranch(task("", "chore/from-the-column"))).toBe("chore/from-the-column");
  });

  // A fix-up task pushes to the branch of ITS PR, which belongs to someone else: the external
  // reference wins when it names one.
  it("prefers the external reference's branch when it carries one", () => {
    expect(taskBranch(task('{"branch":"fix/pr-42"}', "chore/its-own"))).toBe("fix/pr-42");
  });

  it("returns null when no branch is fixed: a task never run has none", () => {
    expect(taskBranch(task(null, null))).toBe(null);
    expect(taskBranch(task("{}", null))).toBe(null);
  });
});
