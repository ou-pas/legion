// The "Run" shortcut must do EXACTLY what the click does, and stay silent while typing: a review
// comment or a secret submit on the same combo (ui/submit-key.ts), and the two gestures must never
// fire together.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLaunchShortcut } from "./use-launch-shortcut.js";

function press(target: EventTarget, key = "Enter", modifier: "metaKey" | "ctrlKey" = "ctrlKey") {
  const event = new KeyboardEvent("keydown", {
    key,
    [modifier]: true,
    cancelable: true,
    bubbles: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("useLaunchShortcut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("⌘/Ctrl+Enter runs, like the button", () => {
    const onLaunch = vi.fn();
    renderHook(() => useLaunchShortcut(true, onLaunch));
    press(window, "Enter", "metaKey");
    expect(onLaunch).toHaveBeenCalledTimes(1);
    press(window, "Enter", "ctrlKey");
    expect(onLaunch).toHaveBeenCalledTimes(2);
  });

  it("plain Enter does not run", () => {
    const onLaunch = vi.fn();
    renderHook(() => useLaunchShortcut(true, onLaunch));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("absent when the button is (`enabled` false)", () => {
    const onLaunch = vi.fn();
    renderHook(() => useLaunchShortcut(false, onLaunch));
    press(window);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("silent while typing: a focused field has the last word", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const onLaunch = vi.fn();
    renderHook(() => useLaunchShortcut(true, onLaunch));
    press(input);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("silent in a textarea and a contenteditable", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const onLaunch = vi.fn();
    renderHook(() => useLaunchShortcut(true, onLaunch));
    press(textarea);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("unmounted, it listens to nothing", () => {
    const onLaunch = vi.fn();
    const { unmount } = renderHook(() => useLaunchShortcut(true, onLaunch));
    unmount();
    press(window);
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
