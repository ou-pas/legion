// Focus opens the bubble only when visible (07/09). A modal sets initial focus in code
// (`useDialogA11y`): when it landed on the close button, its "Close" bubble showed on open with no
// keyboard touched. Hover is unaffected; only focus tells "set by Tab" from "set by script or click".
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./tooltip.js";

afterEach(() => {
  cleanup();
});

/** jsdom does not know what a visible focus is: we dictate it, on the element receiving focus (the
 *  button), not the wrapper, since `:focus-visible` does not propagate to ancestors. */
function mountWithFocusVisible(visible: boolean | "throws") {
  render(
    <Tooltip label="Close">
      <button type="button">×</button>
    </Tooltip>,
  );
  const button = screen.getByRole("button");
  vi.spyOn(button, "matches").mockImplementation((selector: string) => {
    if (selector !== ":focus-visible") return false;
    if (visible === "throws") throw new SyntaxError("unsupported selector");
    return visible;
  });
  return button;
}

describe("useTooltipTrigger — opening on focus", () => {
  it("focus set by code (not :focus-visible) opens nothing", () => {
    const button = mountWithFocusVisible(false);
    fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keyboard focus (:focus-visible) opens the bubble right away", () => {
    const button = mountWithFocusVisible(true);
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Close");
  });

  it("if the browser ignores :focus-visible, focus opens as before", () => {
    const button = mountWithFocusVisible("throws");
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Close");
  });
});
