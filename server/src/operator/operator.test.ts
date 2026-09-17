// Token and session rules without HTTP (13/09). `operator-guard.test.ts` covers the wiring with
// real requests; here: an absent token is not an empty one, a closed session does not reopen, and
// the clear token is written nowhere.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-operator-rules-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const {
  closeSession,
  ensureOperatorToken,
  openSession,
  resetOperatorToken,
  sessionIsOpen,
  tokenMatches,
} = await import("./operator.js");
const { operatorTokenHash, allOperatorSessions } = await import("./operator-store.js");

describe("the instance token", () => {
  it("is created once: two boots do not change it", () => {
    ensureOperatorToken();
    const first = operatorTokenHash();
    assert.ok(first);
    ensureOperatorToken();
    assert.equal(operatorTokenHash(), first, "a restart must not invalidate access");
  });

  it("is stored only as a hash: a leaked database gives no way in", () => {
    const token = resetOperatorToken();
    const stored = operatorTokenHash();
    assert.ok(stored);
    assert.notEqual(stored, token);
    assert.match(stored, /^[0-9a-f]{64}$/, "a hex sha-256, nothing else");
  });

  it("accepts the right one and refuses the rest", () => {
    const token = resetOperatorToken();
    assert.equal(tokenMatches(token), true);
    assert.equal(tokenMatches(`${token}x`), false);
    assert.equal(tokenMatches(token.slice(0, -1)), false);
  });

  it("refuses absent and empty alike: neither is a proof", () => {
    resetOperatorToken();
    assert.equal(tokenMatches(undefined), false);
    assert.equal(tokenMatches(""), false);
  });

  it("regenerating it invalidates the old token and nothing else", () => {
    const before = resetOperatorToken();
    const id = openSession("token");
    const after = resetOperatorToken();
    assert.equal(tokenMatches(before), false);
    assert.equal(tokenMatches(after), true);
    // A session already obtained stays open: rotation does not close sessions.
    assert.equal(sessionIsOpen(id), true);
  });
});

describe("the session", () => {
  it("opens with an id derived from nothing", () => {
    const a = openSession("token");
    const b = openSession("token");
    assert.notEqual(a, b);
    assert.ok(a.length >= 40, "32 bytes in base64url, not a counter");
  });

  it("records how it was obtained: passkey will read this field without a migration", () => {
    const id = openSession("passkey");
    const row = allOperatorSessions().find((s) => s.id === id);
    assert.equal(row?.method, "passkey");
  });

  it("once closed, does not reopen", () => {
    const id = openSession("token");
    assert.equal(sessionIsOpen(id), true);
    closeSession(id);
    assert.equal(sessionIsOpen(id), false);
  });

  it("an invented id opens nothing", () => {
    assert.equal(sessionIsOpen("never-issued"), false);
    assert.equal(sessionIsOpen(undefined), false);
  });

  it("each check refreshes last seen", () => {
    const id = openSession("token");
    const t1 = new Date(1_700_000_000_000);
    const t2 = new Date(1_700_000_060_000);
    sessionIsOpen(id, t1);
    const first = allOperatorSessions()
      .find((s) => s.id === id)
      ?.lastSeenAt?.getTime();
    sessionIsOpen(id, t2);
    const second = allOperatorSessions()
      .find((s) => s.id === id)
      ?.lastSeenAt?.getTime();
    assert.equal(first, t1.getTime());
    assert.equal(second, t2.getTime());
  });
});
