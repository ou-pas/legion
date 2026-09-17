// A task's PR flow state. Three questions, three pieces of UI: does the PR tab exist, does a draft
// await a decision, and what does the draft say.
import { describe, expect, it } from "vitest";
import { canOpenPr, hasPrTab, parsePrDraft, pendingPr, prUrlsOf } from "./pr-state.js";

describe("prUrlsOf", () => {
  it('tolerates the empty field: a task without PR carries "", not "[]"', () => {
    expect(prUrlsOf({ prUrls: "" })).toEqual([]);
  });

  it("rereads the column JSON", () => {
    expect(prUrlsOf({ prUrls: '[{"repo":"web","url":"https://x/1"}]' })).toEqual([
      { repo: "web", url: "https://x/1" },
    ]);
  });

  it('an unreadable value means "no PR", not a blank page at render', () => {
    expect(prUrlsOf({ prUrls: "not json" })).toEqual([]);
  });
});

describe("hasPrTab / pendingPr", () => {
  const pr = [{ repo: "web", url: "https://x/1" }];

  it("no PR tab while there is nothing to read there", () => {
    expect(hasPrTab(["notes.md"], [])).toBe(false);
  });

  it("a draft is enough to open the tab, so is an already created PR", () => {
    expect(hasPrTab(["pr.md"], [])).toBe(true);
    expect(hasPrTab([], pr)).toBe(true);
  });

  // Slice nav/12: the PR opens by itself when a session pushed. If that opening fails there is
  // neither draft nor URL, and without this third term the tab vanished exactly when the gesture had
  // to be retried.
  it("the tab stays open on pushed code, `pr.md` or not", () => {
    expect(hasPrTab([], [], true)).toBe(true);
  });

  // 14/09 (interview "affichage bouton pr sur channel"): `pr.md` alone no longer arms the button, a
  // draft without commits can never succeed at the forge.
  it('"pending" = pushed code and NO PR: that arms the button', () => {
    expect(pendingPr([], true)).toBe(true);
    expect(pendingPr(pr, true)).toBe(false);
    expect(pendingPr([], false)).toBe(false);
  });

  it("`pr.md` alone arms nothing: there is no push to open", () => {
    expect(pendingPr([], false)).toBe(false);
  });
});

describe("canOpenPr", () => {
  // The forge state no longer decides display (15/09): a half-failed opening leaves a PR on one side
  // and nothing on the other, exactly when clicking again must be possible.
  it("the gesture follows the push, and nothing else", () => {
    expect(canOpenPr(true)).toBe(true);
    expect(canOpenPr(false)).toBe(false);
  });
});

describe("parsePrDraft", () => {
  it("first line = title, Markdown hashes stripped", () => {
    expect(parsePrDraft("## Fix the /workspace mount\n\nThe body.\nMore.")).toEqual({
      title: "Fix the /workspace mount",
      body: "The body.\nMore.",
    });
  });

  it("a missing draft is not an error: empty title and body", () => {
    expect(parsePrDraft(null)).toEqual({ title: "", body: "" });
  });

  it("a lone title leaves an empty body", () => {
    expect(parsePrDraft("# Titre seul")).toEqual({ title: "Titre seul", body: "" });
  });

  it("does not eat a hash that is not a Markdown heading", () => {
    expect(parsePrDraft("fix(#42): the mount").title).toBe("fix(#42): the mount");
  });
});
