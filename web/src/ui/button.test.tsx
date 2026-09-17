// IconBtn lacked Button's `loading` state (operator request, 04/09): clicking an icon that fires a
// request never showed the click was taken. Two paths coexist: an explicit `loading`, or a promise
// returned by `onClick` (instead of `void`-ed) that IconBtn awaits. These tests cover the mechanism,
// not its callers.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, IconBtn } from "./button.js";
import { MIN_BUSY_MS } from "./busy.js";

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

describe("IconBtn — the spinner follows the promise returned by onClick", () => {
  it("shows while the promise is pending, disappears when it resolves", async () => {
    const { promise, resolve } = deferred();
    render(
      <IconBtn title="Delete rule" onClick={() => promise}>
        ×
      </IconBtn>,
    );

    const btn = screen.getByRole("button", { name: "Delete rule" });
    expect(btn.getAttribute("data-loading")).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute("data-loading")).toBe("true");
    expect(btn.getAttribute("aria-busy")).toBe("true");

    resolve();
    // Settling goes back through React outside any `fireEvent`: `waitFor` waits for the re-render
    // instead of assuming a number of ticks.
    await waitFor(() => expect(btn.getAttribute("data-loading")).toBeNull());
  });

  it("also disappears when the promise rejects, and the rejection still reaches the caller", async () => {
    const { promise, reject } = deferred();
    const onRejected = vi.fn();
    // Like a real caller: IconBtn must not keep this `.catch` from being notified.
    const tracked = promise.catch((e: unknown) => {
      onRejected(e);
    });

    render(
      <IconBtn title="Delete rule" onClick={() => promise}>
        ×
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "Delete rule" });

    fireEvent.click(btn);
    expect(btn.getAttribute("data-loading")).toBe("true");

    reject(new Error("refused"));
    await tracked;
    await waitFor(() => expect(btn.getAttribute("data-loading")).toBeNull());

    expect(onRejected).toHaveBeenCalledWith(new Error("refused"));
  });

  it("a second click while loading does not call the handler again", () => {
    const { promise } = deferred();
    const onClick = vi.fn(() => promise);
    render(
      <IconBtn title="Delete rule" onClick={onClick}>
        ×
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "Delete rule" });

    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a synchronous onClick never shows a spinner (no flicker)", () => {
    const onClick = vi.fn();
    render(
      <IconBtn title="Collapse" onClick={onClick}>
        ×
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "Collapse" });

    fireEvent.click(btn);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("data-loading")).toBeNull();
  });

  it("an explicit `loading` wins, even with no promise in flight", () => {
    render(
      <IconBtn title="Refresh" loading onClick={() => {}}>
        ×
      </IconBtn>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn.getAttribute("data-loading")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Button — the spinner follows the promise returned by onClick (16/09)", () => {
  it("aria-busy and disabled while waiting, cleared on settlement", async () => {
    const { promise, resolve } = deferred();
    render(<Button onClick={() => promise}>Run</Button>);
    const btn = screen.getByRole("button", { name: "Run" });

    expect(btn.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    resolve();
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("a rejection also releases the spinner, never stuck on an error", async () => {
    const { promise, reject } = deferred();
    const tracked = promise.catch(() => {});
    render(<Button onClick={() => promise}>Run</Button>);
    const btn = screen.getByRole("button", { name: "Run" });

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-busy")).toBe("true");

    reject(new Error("refused"));
    await tracked;
    await waitFor(() => expect(btn.getAttribute("aria-busy")).toBeNull());
  });

  it("an explicit `loading` wins over the promise, so already wired buttons do not change", () => {
    const onClick = vi.fn(() => Promise.resolve());
    render(
      <Button loading onClick={onClick}>
        Run
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Run" }).getAttribute("aria-busy")).toBe("true");
  });

  it(`holds the spinner ${MIN_BUSY_MS} ms even when the response is immediate`, async () => {
    vi.useFakeTimers();
    try {
      render(<Button onClick={() => Promise.resolve()}>Run</Button>);
      const btn = screen.getByRole("button", { name: "Run" });

      await act(async () => {
        fireEvent.click(btn);
        // Let the already resolved promise's microtask pass through `.then(clear, clear)`: timers
        // are fake, microtasks (real Promises) are not.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(btn.getAttribute("aria-busy")).toBe("true");

      await act(async () => vi.advanceTimersByTime(MIN_BUSY_MS - 1));
      expect(btn.getAttribute("aria-busy")).toBe("true");

      await act(async () => vi.advanceTimersByTime(1));
      expect(btn.getAttribute("aria-busy")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Button — the shortcut reads ON the button, never beside it", () => {
  it("renders inside the button when `shortcut` is given, outside the accessible name", () => {
    render(<Button shortcut="⌘/Ctrl+↵ to send">Run</Button>);
    // The accessible name stays "Run" alone: the shortcut is `aria-hidden`, nobody hears it glued to
    // the label.
    const btn = screen.getByRole("button", { name: "Run" });
    expect(btn.textContent).toBe("Run⌘/Ctrl+↵ to send");
  });

  it("renders nothing more without `shortcut`", () => {
    render(<Button>Run</Button>);
    expect(screen.getByRole("button", { name: "Run" }).textContent).toBe("Run");
  });
});
