// `parseBody` is where an `/internal` body becomes a typed value: what it lets through, services
// receive unchecked. Mounted in a real Hono app, since it reads Hono's `c.req.json()`, not a fake.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import { z } from "zod";
import { type ParsedBody, parseBody } from "./parse-body.js";

const schema = z.strictObject({
  kind: z.enum(["text", "choice"]),
  choices: z.array(z.strictObject({ id: z.string(), label: z.string() })).optional(),
});

const app = new Hono().post("/", async (c) => c.json(await parseBody(c, schema)));
const post = async (body: string): Promise<ParsedBody<z.infer<typeof schema>>> => {
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return (await res.json()) as ParsedBody<z.infer<typeof schema>>;
};

describe("parseBody: a request body becomes a validated value, or a readable refusal", () => {
  it("a conforming body returns the value as is", async () => {
    const body = { kind: "choice", choices: [{ id: "a", label: "A" }] };
    assert.deepEqual(await post(JSON.stringify(body)), { ok: true, value: body });
  });

  it("an unknown key is refused BY NAME, never silently ignored", async () => {
    const res = await post(JSON.stringify({ kind: "text", reason: "operator-pause" }));
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error, 'invalid body: Unrecognized key: "reason"');
  });

  it("a deep fault carries its path, and several faults fit on one line", async () => {
    const res = await post(JSON.stringify({ kind: "poem", choices: [{ id: 1, label: "A" }] }));
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(
      res.error,
      'invalid body: kind — Invalid option: expected one of "text"|"choice"' +
        " · choices.0.id — Invalid input: expected string, received number",
    );
  });

  it("unreadable JSON is a refusal of the same family, not an exception", async () => {
    assert.deepEqual(await post("{ not json"), {
      ok: false,
      error: "invalid body: unreadable JSON",
    });
  });

  it("a body that is not an object is refused too", async () => {
    const res = await post(JSON.stringify("text"));
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /expected object, received string/);
  });
});
