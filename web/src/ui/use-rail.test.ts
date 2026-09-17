// The rail's collapsed state must survive a reload, and a browser that refuses storage. Unmounting
// and remounting the hook stands in for a reload: the only moment the initial state is read again.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAIL_STORAGE_KEY, useRail } from "./use-rail.js";

function pressShortcut(key: string, modifier: "metaKey" | "ctrlKey" = "metaKey") {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, [modifier]: true, cancelable: true }));
  });
}

describe("useRail", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("renders the rail expanded when nothing was ever collapsed", () => {
    const { result } = renderHook(() => useRail());
    expect(result.current.collapsed).toBe(false);
  });

  it("collapsed then reloaded, the rail stays collapsed", () => {
    const first = renderHook(() => useRail());
    act(() => first.result.current.toggle());
    expect(first.result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("true");
    first.unmount();

    const reloaded = renderHook(() => useRail());
    expect(reloaded.result.current.collapsed).toBe(true);
  });

  it("expanded then reloaded, the rail stays expanded", () => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, "true");
    const first = renderHook(() => useRail());
    act(() => first.result.current.toggle());
    expect(first.result.current.collapsed).toBe(false);
    first.unmount();

    const reloaded = renderHook(() => useRail());
    expect(reloaded.result.current.collapsed).toBe(false);
  });

  it("the shortcut does the same as the button, and persists the same way", () => {
    const { result, unmount } = renderHook(() => useRail());
    pressShortcut("b");
    expect(result.current.collapsed).toBe(true);
    // Ctrl+B for those not on macOS: same path, other modifier.
    pressShortcut("B", "ctrlKey");
    expect(result.current.collapsed).toBe(false);
    pressShortcut("b");
    unmount();

    const reloaded = renderHook(() => useRail());
    expect(reloaded.result.current.collapsed).toBe(true);
  });

  it('ignores a key without modifier: "b" is typed in a field', () => {
    const { result } = renderHook(() => useRail());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    });
    expect(result.current.collapsed).toBe(false);
  });

  it("a browser refusing storage renders an expanded rail, and still collapses", () => {
    // Safari private browsing throws on both reads and writes, not only on writes.
    const refuse = () => {
      throw new DOMException("storage refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);

    const { result } = renderHook(() => useRail());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});
