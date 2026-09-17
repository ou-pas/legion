// What the error page may promise. One fact carries it all: telling a STALE screen (one requesting a
// chunk the update renamed) from any other crash. Wrong one way, a screen that cannot heal is
// reloaded in a loop; wrong the other, a page merely older than the server reads as a failure.
import { describe, expect, it } from "vitest";
import { crashMessage, isStaleScreen } from "./crash.js";

describe("isStaleScreen", () => {
  // The three engines word the same failure differently, and none is normalised. WebKit's matters
  // most: it is the installed app's browser.
  it("recognises a missing chunk, whatever the engine", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://app.example.test/assets/AgentPage-BoE_IbB8.js",
      "Importing a module script failed.",
      "error loading dynamically imported module",
      "Load failed",
    ])
      expect(isStaleScreen(new Error(message))).toBe(true);
  });

  it("does not mistake a real crash for a stale screen", () => {
    for (const message of [
      "t.segments is undefined",
      "Cannot read properties of null (reading 'id')",
      "Maximum update depth exceeded",
      "",
    ])
      expect(isStaleScreen(new Error(message))).toBe(false);
  });

  // An error page crashing while reading the error is the worst place to crash, and a `throw`
  // carries whatever it likes.
  it("survives a thrown value that is not an Error", () => {
    for (const thrown of [undefined, null, 42, {}, ["boom"]])
      expect(isStaleScreen(thrown)).toBe(false);
    expect(isStaleScreen("Importing a module script failed.")).toBe(true);
  });
});

describe("crashMessage", () => {
  it("returns the message when there is one, an empty string otherwise", () => {
    expect(crashMessage(new Error("boom"))).toBe("boom");
    expect(crashMessage("boom")).toBe("boom");
    expect(crashMessage({ boom: true })).toBe("");
    expect(crashMessage(undefined)).toBe("");
  });
});
