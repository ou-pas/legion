// ConfirmAction relays its inner button's mechanism (16/09): the confirming second click returns
// `onConfirm`'s result to `Button`, which detects the promise and holds the spinner until it
// settles, floor included (`ui/busy.ts`). Covers the mechanism, not its callers, like
// `button.test.tsx`.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmAction } from "./confirm-action.js";

afterEach(() => {
  cleanup();
});

/** A promise whose settlement the test controls by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Arm then confirm: the two clicks of an operator in a hurry. */
function confirm(label: string, confirmLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: confirmLabel }));
}

describe("ConfirmAction — the spinner follows the promise returned by onConfirm", () => {
  it("aria-busy and disabled while waiting, cleared on settlement", async () => {
    const { promise, resolve } = deferred();
    render(<ConfirmAction label="Delete" confirmLabel="Delete?" onConfirm={() => promise} />);

    confirm("Delete", "Delete?");
    // The confirming click disarms the button (`setArmed(false)`): its accessible name goes back to
    // `label`, not `confirmLabel`. Busy is a state separate from armed.
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    resolve();
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
  });

  it("a rejection also releases the spinner, never stuck on an error", async () => {
    const { promise, reject } = deferred();
    const tracked = promise.catch(() => {});
    render(<ConfirmAction label="Delete" confirmLabel="Delete?" onConfirm={() => promise} />);

    confirm("Delete", "Delete?");
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.getAttribute("aria-busy")).toBe("true");

    reject(new Error("refused"));
    await tracked;
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
  });

  it("an explicit `loading` (caller-driven mutation) wins over the promise", () => {
    render(
      <ConfirmAction
        label="Clean up"
        confirmLabel="Clean up?"
        loading
        disabled
        onConfirm={() => Promise.resolve()}
      />,
    );
    // Disabled: the first click does not arm, the button keeps its resting label, which is already
    // the state `loading`+`disabled` describes.
    const btn = screen.getByRole("button", { name: "Clean up" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("the first click arms without calling onConfirm; only the second confirms", () => {
    let calls = 0;
    render(
      <ConfirmAction
        label="Delete"
        confirmLabel="Delete?"
        onConfirm={() => {
          calls += 1;
          return Promise.resolve();
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toBe(0);
    expect(screen.getByRole("button", { name: "Delete?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
    expect(calls).toBe(1);
  });
});
