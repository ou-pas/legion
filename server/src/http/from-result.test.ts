// What it returns is the contract five domains follow, read here without a database or real route.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { done, fromResult, refuse } from "./from-result.js";

const app = new Hono();
app.get("/object", (c) => fromResult(c, done({ id: "g1", name: "a goal" })));
app.get("/array", (c) => fromResult(c, done([1, 2, 3])));
app.get("/empty", (c) => fromResult(c, done()));
app.get("/created", (c) => fromResult(c, done({ id: "n1" }), 201));
app.get("/not-found", (c) => fromResult(c, refuse(404, "goal not found")));
app.get("/conflict", (c) => fromResult(c, refuse(409, "goal is paused")));
app.get("/forge", (c) => fromResult(c, refuse(502, "the forge did not answer")));

const body = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, json: (await res.json()) as unknown };
};

describe("fromResult", () => {
  it("success returns ITS value, without envelope: the body is unchanged", async () => {
    assert.deepEqual(await body("/object"), { status: 200, json: { id: "g1", name: "a goal" } });
  });

  it("an array passes as is, which no `{ ok: true } & T` could do", async () => {
    assert.deepEqual(await body("/array"), { status: 200, json: [1, 2, 3] });
  });

  it("a service without a value returns `{ ok: true }`, the body these routes already returned", async () => {
    assert.deepEqual(await body("/empty"), { status: 200, json: { ok: true } });
  });

  it("`okStatus` serves creations", async () => {
    assert.deepEqual(await body("/created"), { status: 201, json: { id: "n1" } });
  });

  it("each refusal leaves under ITS status, with its sentence intact", async () => {
    assert.deepEqual(await body("/not-found"), {
      status: 404,
      json: { error: "goal not found" },
    });
    assert.deepEqual(await body("/conflict"), { status: 409, json: { error: "goal is paused" } });
    assert.deepEqual(await body("/forge"), {
      status: 502,
      json: { error: "the forge did not answer" },
    });
  });
});
