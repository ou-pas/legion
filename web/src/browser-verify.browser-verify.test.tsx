// Temporary, NOT committed: proves a real DOM render + hover assertion through the shared
// browser mechanism (task 8jZtM1gy9n). Deleted after the verification run.
import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import { useState } from "react";

afterEach(cleanup);

function Hoverable() {
  const [hovered, setHovered] = useState(false);
  return (
    <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {hovered ? "hovered" : "idle"}
    </button>
  );
}

test("renders in a real browser via BROWSER_WS_ENDPOINT", async () => {
  render(<Hoverable />);
  await expect.element(page.getByRole("button")).toHaveTextContent("idle");
});

test("hover works through connectOptions (full chromium, not headless-shell)", async () => {
  render(<Hoverable />);
  await page.getByRole("button").hover();
  await expect.element(page.getByRole("button")).toHaveTextContent("hovered");
});
