// Enter alone never sends (07/09). The operator sent a half-written inbox reply by pressing Enter:
// on input addressed to an agent, sending restarts a session and cannot be undone. These cases pin
// the chosen convention, Slack's, Linear's and GitHub's.
import { describe, expect, it } from "vitest";
import { isSubmitKey, type SubmitKeyEvent } from "./submit-key.js";

const enter = (over: Partial<SubmitKeyEvent> = {}): SubmitKeyEvent => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  nativeEvent: { isComposing: false },
  ...over,
});

describe("isSubmitKey", () => {
  it("Enter alone does not send", () => {
    expect(isSubmitKey(enter())).toBe(false);
  });

  it("Shift+Enter does not send either: it is a newline, as everywhere else", () => {
    expect(isSubmitKey(enter({ shiftKey: true }))).toBe(false);
  });

  it("⌘+Enter sends (macOS)", () => {
    expect(isSubmitKey(enter({ metaKey: true }))).toBe(true);
  });

  it("Ctrl+Enter sends (other platforms)", () => {
    expect(isSubmitKey(enter({ ctrlKey: true }))).toBe(true);
  });

  it("another key with ⌘ does not send", () => {
    expect(isSubmitKey(enter({ key: "k", metaKey: true }))).toBe(false);
  });

  it("during IME composition, Enter confirms the word and does not send", () => {
    expect(isSubmitKey(enter({ metaKey: true, nativeEvent: { isComposing: true } }))).toBe(false);
  });
});
