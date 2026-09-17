// Debounced draft saving (07/09). Three properties, each a way to lose work:
//
//  · debounce: three keystrokes in a row make one write;
//  · last write WINS: the server REPLACES the draft, so crossing requests would let the slower overwrite
//    the newer. The hook never sends two at once and replays what arrived during the flight;
//  · nothing leaves after unmount: a timer outliving the page writes to a question no longer viewed
//    and sets React state on an unmounted component.
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInboxDraft, type DraftValues } from "./use-inbox-draft.js";

afterEach(cleanup);

type Draft = ReturnType<typeof useInboxDraft>;

/** A minimal host: the hook needs a component, the test needs its outputs. Exposed through an EFFECT,
 *  not an assignment during render (a side effect `react(globals)` rightly refuses). The effect runs
 *  after each render, so `draft()` always returns the latest version. */
function harness(save: (formData: DraftValues) => Promise<unknown>, delay = 500) {
  let api: Draft | null = null;
  function Probe() {
    const draft = useInboxDraft(save, delay);
    useEffect(() => {
      api = draft;
    });
    return null;
  }
  const view = render(<Probe />);
  return { draft: (): Draft => api!, view };
}

/** A hand-resolved promise, to test "during the flight". */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useInboxDraft", () => {
  it("writes NOTHING before the delay, then writes once", async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { draft } = harness(save);

    act(() => {
      draft().schedule({ a: "1" });
    });
    act(() => {
      draft().schedule({ a: "12" });
    });
    act(() => {
      draft().schedule({ a: "123" });
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(save).toHaveBeenCalledTimes(1);
    // The LAST value, not the first: the two earlier keystrokes no longer exist.
    expect(save).toHaveBeenCalledWith({ a: "123" });
    vi.useRealTimers();
  });

  it("announces `saving` DURING the flight, then `saved` with its time", async () => {
    // With an already resolved promise React merges both states in one render and the saving
    // mention never shows, as intended (an instant save must not flicker), so the intermediate state
    // is only observable with a slow request.
    vi.useFakeTimers();
    const flight = deferred();
    const { draft } = harness(() => flight.promise);
    act(() => {
      draft().schedule({ a: "1" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(draft().status.kind).toBe("saving");

    await act(async () => {
      flight.resolve();
      await Promise.resolve();
    });
    expect(draft().status.kind).toBe("saved");
    vi.useRealTimers();
  });

  it("LAST WRITE WINS: nothing leaves while a request flies", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const calls: DraftValues[] = [];
    const save = vi.fn((formData: DraftValues) => {
      calls.push(formData);
      return calls.length === 1 ? first.promise : Promise.resolve();
    });
    const { draft } = harness(save);

    act(() => {
      draft().schedule({ a: "1" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toEqual([{ a: "1" }]);

    // Two changes during the flight: the second replaces the first, and NEITHER leaves.
    act(() => {
      draft().schedule({ a: "2" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      draft().schedule({ a: "3" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(calls).toEqual([{ a: "1" }]);

    // The flight ends → the last value leaves, alone.
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(calls).toEqual([{ a: "1" }, { a: "3" }]);
    vi.useRealTimers();
  });

  it('a refusal keeps the server MESSAGE, not an anonymous "failure"', async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.reject(new Error("the question is no longer open")));
    const { draft } = harness(save);
    act(() => {
      draft().schedule({ a: "1" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(draft().status).toEqual({ kind: "error", message: "the question is no longer open" });
    vi.useRealTimers();
  });

  it("unmount cancels what has not left", async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { draft, view } = harness(save);
    act(() => {
      draft().schedule({ a: "1" });
    });
    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("`discard` forgets what has not left: the final send already clears the draft", async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const { draft } = harness(save);
    act(() => {
      draft().schedule({ a: "1" });
    });
    act(() => {
      draft().discard();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
