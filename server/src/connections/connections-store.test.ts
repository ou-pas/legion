// Domain queries against a real database: column reads are what is checked, and a database double
// would prove reading a double.
//
// The fragile part: `renewable` reads `refresh_ciphertext`, no longer `metadata`. Both columns are
// filled by the same `putSecret` call, and no type says which answers which question.
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-connections-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { putSecret } = await import("../projects/secrets.js");
const { connectedSecretNames, secretRowFor, secretsWithoutProviderFacts } =
  await import("./connections-store.js");

db.insert(schema.projects)
  .values([
    { id: "p1", name: "one", slug: "one", createdAt: new Date() },
    { id: "p2", name: "two", slug: "two", createdAt: new Date() },
    { id: "p3", name: "three", slug: "three", createdAt: new Date() },
  ])
  .run();

putSecret({ projectId: "p1", name: "PASTED", value: "v1" });
putSecret({
  projectId: "p1",
  name: "GRANTED_NO_REFRESH",
  value: "v2",
  metadata: { provider: "github", origin: "granted", scopes: ["repo"] },
});
putSecret({
  projectId: "p1",
  name: "GRANTED_WITH_REFRESH",
  value: "v3",
  refreshToken: "r3",
  metadata: { provider: "linear", origin: "granted" },
});
putSecret({ projectId: "p2", name: "ELSEWHERE", value: "v4" });

describe("connectedSecretNames", () => {
  const posed = () => new Map(connectedSecretNames("p1").map((s) => [s.name, s]));

  it("returns only the requested project's secrets", () => {
    assert.deepEqual([...posed().keys()].sort(), [
      "GRANTED_NO_REFRESH",
      "GRANTED_WITH_REFRESH",
      "PASTED",
    ]);
  });

  it("`renewable` reads renewal, not the presence of metadata", () => {
    // Both directions of the divergence on one result: a granted credential (it has metadata) without a
    // refresh token is not renewable, like today's GitHub connection, which the old signal declared
    // renewable.
    assert.equal(posed().get("GRANTED_NO_REFRESH")!.renewable, false);
    assert.equal(posed().get("GRANTED_WITH_REFRESH")!.renewable, true);
    assert.equal(posed().get("PASTED")!.renewable, false);
  });

  it("returns raw metadata without deciding: the rule reads it", () => {
    assert.equal(posed().get("PASTED")!.metadata, null);
    assert.match(String(posed().get("GRANTED_NO_REFRESH")!.metadata), /"scopes":\["repo"\]/);
  });

  it("returns since when, or a connected tile has only “connected” to say", () => {
    const posee = posed().get("PASTED")!.createdAt;

    assert.ok(posee instanceof Date);
    assert.ok(Number.isFinite(posee.getTime()), "an unreadable date places nothing in time");
  });

  it("returns no secret value: the UI asks who is connected, not with what", () => {
    const row = posed().get("PASTED")!;

    assert.equal("ciphertext" in row, false);
    assert.equal(JSON.stringify(row).includes("v1"), false);
  });
});

describe("secretRowFor", () => {
  it("returns the three columns at once: three queries would give three snapshots", () => {
    const row = secretRowFor("p1", "GRANTED_WITH_REFRESH");

    assert.ok(row);
    assert.ok(row.ciphertext.length > 0);
    assert.ok(row.refreshCiphertext && row.refreshCiphertext.length > 0);
    assert.notEqual(row.ciphertext, "v3", "the value is encrypted in the database, never clear");
    assert.notEqual(row.refreshCiphertext, "r3");
  });

  it("returns `null` for a missing name or another project's secret", () => {
    assert.equal(secretRowFor("p1", "NEVER_SET"), null);
    assert.equal(secretRowFor("p1", "ELSEWHERE"), null);
  });
});

// What adoption looks for, and why it is no longer "no `metadata`" (15/09). Data patch
// `p1-secrets-vers-connexions` writes a `metadata` at boot on every provider row lacking one (provider
// and origin, never account or scopes). Looking for `metadata IS NULL` would find nothing on exactly
// the target rows. The criterion is now the absence of `probedAt`: the provider never answered.
describe("secretsWithoutProviderFacts", () => {
  // In a separate project: the query looks at the whole database, so rows in `p1` would change what
  // `connectedSecretNames` finds there.
  putSecret({ projectId: "p3", name: "NEVER_PROBED", value: "v5" });
  putSecret({
    projectId: "p3",
    name: "PATCHED_OFFLINE",
    value: "v6",
    metadata: { provider: "github", origin: "pasted" },
  });
  putSecret({
    projectId: "p3",
    name: "PROBED_WITH_FACTS",
    value: "v7",
    metadata: { provider: "linear", origin: "pasted", account: "romuald", probedAt: 1 },
  });
  // The looping row: Linear always returns `scopes: null`, and an account without name or email returns
  // `account: null`. The probe answered and simply found nothing.
  putSecret({
    projectId: "p3",
    name: "PROBED_EMPTY_HANDED",
    value: "v8",
    metadata: { provider: "linear", origin: "pasted", probedAt: 1 },
  });
  putSecret({
    projectId: "p3",
    name: "GRANTED_LEAN",
    value: "v10",
    metadata: { provider: "linear", origin: "granted" },
  });
  putSecret({
    projectId: "p3",
    name: "BEFORE_ORIGIN_FIELD",
    value: "v11",
    metadata: { provider: "linear" },
  });
  const found = (...names: string[]) =>
    secretsWithoutProviderFacts(names)
      .map((r) => r.name)
      .sort();

  it("takes a row that never carried anything", () => {
    assert.deepEqual(found("NEVER_PROBED"), ["NEVER_PROBED"]);
  });

  it("takes a row marked by the patch: no provider has spoken", () => {
    assert.deepEqual(
      found("PATCHED_OFFLINE"),
      ["PATCHED_OFFLINE"],
      "otherwise the boot patch would deprive `make adopt-tokens` of its only work",
    );
  });

  it("leaves a row already probed, whether it found something or not", () => {
    // The second case changed the criterion: with "neither account nor scopes", an empty-handed probe
    // left the row eligible forever, and `make adopt-tokens` repeated it on every run.
    assert.deepEqual(found("PROBED_WITH_FACTS", "PROBED_EMPTY_HANDED"), []);
  });

  it("leaves a granted credential, even lean, and an absent origin reads as granted", () => {
    // `constated` writes `origin: pasted` on everything it touches: probing a granted row would turn
    // its origin into a lie. Pre-15/09 `metadata` has no `origin`, which `credentialOrigin` reads as
    // granted, so it stays out too.
    assert.deepEqual(found("GRANTED_LEAN", "BEFORE_ORIGIN_FIELD"), []);
  });

  it("leaves a row with unreadable `metadata`, without failing the query", () => {
    // `json_extract` throws on malformed JSON: without the preceding `json_valid`, one damaged row
    // would fail the whole adoption. And broken `metadata` was written by someone; replacing it would
    // erase what they wrote.
    putSecret({ projectId: "p3", name: "DAMAGED", value: "v9" });
    db.update(schema.secrets)
      .set({ metadata: "{this is not JSON" })
      .where(eq(schema.secrets.name, "DAMAGED"))
      .run();

    assert.deepEqual(found("DAMAGED", "NEVER_PROBED"), ["NEVER_PROBED"]);
  });

  it("returns nothing without querying when asked for no name", () => {
    assert.deepEqual(secretsWithoutProviderFacts([]), []);
  });
});
