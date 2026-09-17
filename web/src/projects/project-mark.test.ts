// A project's mark (nav slice 02, AC#1): stability and spread.
//
// Stability, because a derived mark that moves is worse than a chosen one: the operator learns a
// colour, it changes on reload, and the rail stops reading at a glance. Spread, because two
// similar projects are exactly the ones confused if their squares look alike too.
import { describe, expect, it } from "vitest";
import { PROJECT_HUES, projectMark } from "./project-mark.js";

describe("projectMark", () => {
  it("returns the first two significant letters, uppercased", () => {
    expect(projectMark("Legion", "x").initials).toBe("LE");
    expect(projectMark("kopee.me", "x").initials).toBe("KO");
    // The name starts with what does not show: space, dash, dot.
    expect(projectMark("  acme", "x").initials).toBe("AC");
    expect(projectMark("-2048", "x").initials).toBe("20");
    // Accents and non-Latin alphabets count as letters (the accented name is deliberate).
    expect(projectMark("Étude", "x").initials).toBe("ÉT");
    // Nothing significant: say so, do not render an empty box.
    expect(projectMark("···", "x").initials).toBe("?");
    expect(projectMark("", "x").initials).toBe("?");
  });

  it("always returns the same mark for the same name/id pair", () => {
    const a = projectMark("Kopee.me", "kp9Ax2Lm01");
    for (let i = 0; i < 50; i++) expect(projectMark("Kopee.me", "kp9Ax2Lm01")).toEqual(a);
  });

  it("keeps the hue when the name changes, and the initials when the id changes", () => {
    // Renaming does not move the colour: that is how a renamed project is recognised.
    expect(projectMark("Kopee", "kp9Ax2Lm01").hue).toBe(projectMark("Kopee Web", "kp9Ax2Lm01").hue);
    expect(projectMark("Kopee", "kp9Ax2Lm01").initials).toBe(
      projectMark("Kopee", "zz0Bq7Nn42").initials,
    );
  });

  it("gives different hues to two projects with close names", () => {
    // The real case: a project and its satellite, created in a row, named almost the same.
    const un = projectMark("kopee", "kp9Ax2Lm01");
    const deux = projectMark("kopee-web", "kw3Zt8Qr55");
    expect(un.initials).toBe(deux.initials); // the letters do look alike, hence the colour
    expect(un.hue).not.toBe(deux.hue);
  });

  it("spreads over the whole scale and never leaves it", () => {
    // Twenty plausible ids: if the hash leaned (one step, or half the scale), it would show here,
    // not on a hand-picked pair.
    const ids = Array.from({ length: 20 }, (_, i) => `pr${i}jkt${i * 7}Xz`);
    const hues = ids.map((id) => projectMark("P", id).hue);
    for (const h of hues) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(PROJECT_HUES);
    }
    expect(new Set(hues).size).toBeGreaterThanOrEqual(8);
  });

  // v47, the chosen hue. The default is what is protected: adding a choice must change nothing for
  // projects without one, nor for callers not passing it.
  describe("chosen hue", () => {
    it("without a choice the derived hue holds, whether the argument is absent, undefined or null", () => {
      const derived = projectMark("Kopee", "kp9Ax2Lm01").hue;
      expect(projectMark("Kopee", "kp9Ax2Lm01", undefined).hue).toBe(derived);
      expect(projectMark("Kopee", "kp9Ax2Lm01", null).hue).toBe(derived);
    });

    it("a choice replaces the derived hue, and nothing else of the mark moves", () => {
      const derived = projectMark("Kopee", "kp9Ax2Lm01").hue;
      const other = (derived + 5) % PROJECT_HUES;
      const marked = projectMark("Kopee", "kp9Ax2Lm01", other);
      expect(marked.hue).toBe(other);
      expect(marked.initials).toBe("KO");
    });

    it("clearing it brings back the derived hue", () => {
      const derived = projectMark("Kopee", "kp9Ax2Lm01").hue;
      const chosen = projectMark("Kopee", "kp9Ax2Lm01", (derived + 3) % PROJECT_HUES).hue;
      expect(chosen).not.toBe(derived);
      expect(projectMark("Kopee", "kp9Ax2Lm01", null).hue).toBe(derived);
    });

    it("ignores an out-of-scale rank rather than render a colourless square", () => {
      const derived = projectMark("Kopee", "kp9Ax2Lm01").hue;
      for (const bad of [PROJECT_HUES, -1, 2.5, Number.NaN])
        expect(projectMark("Kopee", "kp9Ax2Lm01", bad).hue).toBe(derived);
    });
  });
});
