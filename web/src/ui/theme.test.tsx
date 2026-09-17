// Protects against the 14/09 defect: the default theme was hardcoded `light` and the effect wrote
// to `localStorage` on first render. Someone who never touched the switch already had a saved
// preference, and an installed app on a phone in dark mode opened in warm paper.
//
// The facts below break silently: nothing throws, the screen renders, just in the wrong color.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./theme.js";

const KEY = "legion.theme";

/** jsdom has no `matchMedia`: stub it, with a switch that can be flipped to play a system setting
 *  change mid-session. */
function fakeMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => mql);
  return {
    set(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
  };
}

function Probe({ onRender }: { onRender: (api: ReturnType<typeof useTheme>) => void }) {
  onRender(useTheme());
  return null;
}

/** Mounts the provider and returns the last seen API, plus the attribute set on `<html>`. */
function mount() {
  let api: ReturnType<typeof useTheme> = null;
  render(
    <ThemeProvider>
      <Probe
        onRender={(a) => {
          api = a;
        }}
      />
    </ThemeProvider>,
  );
  return {
    get pref() {
      return api?.pref;
    },
    get theme() {
      return api?.theme;
    },
    cycle: () => act(() => api?.cycle()),
    stamped: () => document.documentElement.dataset.theme,
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("with no saved preference, follows the device", () => {
    fakeMatchMedia(true);
    const ui = mount();
    expect(ui.pref).toBe("system");
    expect(ui.theme).toBe("dark");
    expect(ui.stamped()).toBe("dark");
  });

  // The original defect: storage must hold nothing until someone chooses.
  it("writes nothing to storage until a choice is made", () => {
    fakeMatchMedia(true);
    mount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("an explicit choice is saved and no longer follows the device", () => {
    const media = fakeMatchMedia(true);
    const ui = mount();
    ui.cycle(); // system → light
    expect(ui.pref).toBe("light");
    expect(localStorage.getItem(KEY)).toBe("light");
    act(() => media.set(false));
    expect(ui.theme).toBe("light");
  });

  // The way back: without it, following the device again takes clearing storage by hand. That is
  // why the cycle has three positions.
  it('the cycle returns to "system" and clears the preference', () => {
    fakeMatchMedia(false);
    const ui = mount();
    ui.cycle(); // light
    ui.cycle(); // dark
    expect(localStorage.getItem(KEY)).toBe("dark");
    ui.cycle(); // system
    expect(ui.pref).toBe("system");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("in system mode, a setting change switches the theme live", () => {
    const media = fakeMatchMedia(false);
    const ui = mount();
    expect(ui.theme).toBe("light");
    act(() => media.set(true));
    expect(ui.theme).toBe("dark");
    expect(ui.stamped()).toBe("dark");
  });

  // "nord" is the legacy stored value from before the rename: kept on purpose.
  it("a preference saved before the rename still reads", () => {
    fakeMatchMedia(false);
    localStorage.setItem(KEY, "nord");
    expect(mount().theme).toBe("dark");
  });

  it("an unreadable value is not a choice: falls back to the device", () => {
    fakeMatchMedia(true);
    localStorage.setItem(KEY, "mauve");
    const ui = mount();
    expect(ui.pref).toBe("system");
    expect(ui.theme).toBe("dark");
  });
});
