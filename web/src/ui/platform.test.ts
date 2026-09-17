// Protects the recognition rule, on the strings browsers really return.
//
// The derived constants (`MOD`, `combo`) are frozen at load, so they reflect the test environment.
// Measured: jsdom returns an empty platform, so `IS_MAC` is false and every web test renders
// "Ctrl+…". That is a benefit: the non-Mac branch, never seen when developing on a Mac, runs on every
// test run. The Mac branch is checked in a real browser. Only machine-independent facts are asserted.
import { describe, expect, it } from "vitest";
import { combo, ENTER, isMacPlatform, MOD } from "./platform.js";

describe("isMacPlatform", () => {
  it("recognises what `navigator.platform` returns on a Mac", () => {
    for (const p of ["MacIntel", "Mac68K", "MacPPC"]) expect(isMacPlatform(p)).toBe(true);
  });

  it("recognises what `userAgentData.platform` returns, which has a different shape", () => {
    expect(isMacPlatform("macOS")).toBe(true);
    expect(isMacPlatform("Windows")).toBe(false);
    expect(isMacPlatform("Linux")).toBe(false);
  });

  it("counts iPhone and iPad as Macs: an attached keyboard has the Command key", () => {
    for (const p of ["iPhone", "iPad", "iPod touch"]) expect(isMacPlatform(p)).toBe(true);
  });

  it("an unknown or empty platform is not a Mac: the explicit label is the right default", () => {
    for (const p of ["", "Win32", "Linux armv8l", "CrOS x86_64", "Android"])
      expect(isMacPlatform(p)).toBe(false);
  });
});

describe("writing a shortcut", () => {
  // Punctuation is half the matter: "⌘+B" reads as a typo on a Mac, "CtrlB" as a made-up word
  // elsewhere. So the shape is checked, whatever platform the suite runs on.
  it("glues the glyph and separates the word with a plus", () => {
    expect(combo("B")).toBe(MOD === "⌘" ? "⌘B" : "Ctrl+B");
  });

  it("writes a single modifier, never both cases listed", () => {
    // The original defect: "⌘/Ctrl+↵", which makes the reader sort before acting.
    const written = combo("↵");
    expect(written).not.toContain("/");
    expect(written.includes("⌘") && written.includes("Ctrl")).toBe(false);
  });
});

describe("the submit key", () => {
  // A sign on both platforms, never a word: a shortcut is shown, not spelled out. Only the arrow
  // differs, Apple having its own.
  it("is an arrow on both platforms", () => {
    expect(ENTER).toBe(MOD === "⌘" ? "↩" : "↵");
    expect(/^[↩↵]$/u.test(ENTER)).toBe(true);
  });

  it("the plus comes from the modifier, never from the key", () => {
    expect(combo(ENTER)).toBe(MOD === "⌘" ? "⌘↩" : "Ctrl+↵");
  });
});
