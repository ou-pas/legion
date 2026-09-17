import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shQuote } from "./shell.js";

describe("shQuote", () => {
  it("wraps in single quotes", () => {
    assert.equal(shQuote("legion-session:latest"), "'legion-session:latest'");
  });
  it("escapes a literal quote (close, quote, reopen)", () => {
    assert.equal(shQuote("agent's"), "'agent'\\''s'");
  });
  it("empty string: two quotes", () => {
    assert.equal(shQuote(""), "''");
  });
});
