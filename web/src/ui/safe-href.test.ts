import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href.js";

describe("safeHref", () => {
  it.each([
    "https://github.com/ou-pas/legion/pull/2",
    "HTTP://ok",
    "/tasks/x",
    "#anchor",
    "mailto:a@b.c",
  ])("accepts %s as is", (raw) => {
    expect(safeHref(raw)).toBe(raw);
  });

  it.each([
    "javascript:alert(1)",
    " JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:MsgBox(1)",
    "file:///etc/passwd",
    "//evil.example/phish",
    "example.com/no-scheme",
    "",
  ])("refuses %s", (raw) => {
    expect(safeHref(raw)).toBeUndefined();
  });

  it("strips whitespace and control characters before reading the scheme", () => {
    expect(safeHref("java\tscript:alert(1)")).toBeUndefined();
    expect(safeHref("java script:alert(1)")).toBeUndefined();
    expect(safeHref(" https://ok\n")).toBe("https://ok");
  });
});
