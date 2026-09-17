import { describe, expect, it } from "vitest";
import { GOAL_TEXT } from "./text.js";

// "1 iterations" was on screen, and two lots reported it separately without knowing about each
// other. The word sat in the catalogue as a bare string because the count next to it is a <Num>
// chip rather than an interpolation — so nothing agreed it with anything.
describe("the goals iteration count", () => {
  it("agrees its noun in the list subtitle", () => {
    expect(GOAL_TEXT.list.iterations(1)).toBe("iteration");
    expect(GOAL_TEXT.list.iterations(0)).toBe("iterations");
    expect(GOAL_TEXT.list.iterations(4)).toBe("iterations");
  });

  it("agrees its noun in the drift chip", () => {
    expect(GOAL_TEXT.page.drift(1)).toBe("1 iteration — beyond the plan");
    expect(GOAL_TEXT.page.drift(7)).toBe("7 iterations — beyond the plan");
  });
});
