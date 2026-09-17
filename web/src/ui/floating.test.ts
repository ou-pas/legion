// 16/09: `make responsive` measured `.ui-select-list` at 393px in a 375px window, because `clamp()`
// bounded a floating surface's point, never its size. `maxSurfaceWidth()` is the fix shared by
// select, combobox, menu and popover. `make responsive` stays the only judge of rendering (a
// browser, kept out of CI on 09/09); this test holds the computation inside `pnpm test`.
import { afterEach, describe, expect, it } from "vitest";
import { maxSurfaceWidth } from "./floating.js";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
};

describe("maxSurfaceWidth", () => {
  afterEach(() => {
    setViewportWidth(1024); // jsdom's default width
  });

  it("removes the EDGE margin on both sides, in the measured case: a 375px window", () => {
    setViewportWidth(375);
    // The task's acceptance criterion was `width ≤ 359`: 375 - 2×8.
    expect(maxSurfaceWidth()).toBe(359);
  });

  it("follows a wider window", () => {
    setViewportWidth(1280);
    expect(maxSurfaceWidth()).toBe(1264);
  });

  it("is not frozen at the first call: a resize changes the result", () => {
    setViewportWidth(400);
    const first = maxSurfaceWidth();
    setViewportWidth(320);
    expect(maxSurfaceWidth()).not.toBe(first);
    expect(maxSurfaceWidth()).toBe(304);
  });
});
