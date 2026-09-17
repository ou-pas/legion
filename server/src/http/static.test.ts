// With `web/dist`, a pasted view URL renders the app; without it, nothing changes for everyday
// development. The trap: the SPA fallback catches "everything else", and if that includes an
// unknown `/api` route the screen gets HTML instead of JSON (see `web/src/api/client.ts`).
//
// The folder is a parameter, or results would depend on whether `make gates` left a `web/dist` on
// the machine.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";
import { registerStaticRoutes, spaIsBuilt } from "./static.js";

/** A believable `web/dist`: the index and a hashed asset, as Vite produces. */
const dist = mkdtempSync(join(tmpdir(), "legion-dist-"));
const sansBuild = mkdtempSync(join(tmpdir(), "legion-no-dist-"));
after(() => {
  rmSync(dist, { recursive: true, force: true });
  rmSync(sansBuild, { recursive: true, force: true });
});

const INDEX = '<!doctype html><title>Legion</title><div id="root"></div>';
mkdirSync(join(dist, "assets"), { recursive: true });
writeFileSync(join(dist, "index.html"), INDEX);
writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log('screen')");

/** Mounted in the product's order, domain routes first and static last: the order is the guarantee. */
function appWith(dir: string) {
  const a = new Hono();
  a.get("/api/tasks", (c) => c.json({ served: true }));
  a.post("/internal/sessions/s1/events", (c) => c.json({ served: true }));
  registerStaticRoutes(a, dir);
  return a;
}

describe("spaIsBuilt", () => {
  it("relies on index.html, not the folder", () => {
    assert.equal(spaIsBuilt(dist), true);
    assert.equal(spaIsBuilt(sansBuild), false);
    assert.equal(spaIsBuilt(join(sansBuild, "does-not-exist")), false);
  });
});

describe("static serving when the screen is built", () => {
  it("serves a build file with its type", async () => {
    const res = await appWith(dist).request("/assets/index-abc123.js");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
    assert.match(await res.text(), /screen/);
  });

  it("renders the screen at the ROOT", async () => {
    // `/` is what a human types; JSON there looks like an outage.
    const res = await appWith(dist).request("/");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="root">/);
  });

  it("renders the screen on a VIEW URL the server does not know", async () => {
    for (const url of ["/tasks/abc123/diff", "/projects/x/board", "/wiki/concepts/agent"]) {
      const res = await appWith(dist).request(url);
      assert.equal(res.status, 200, url);
      assert.match(await res.text(), /<div id="root">/, url);
    }
  });

  it("lets a SERVED route win, because it is registered first", async () => {
    const res = await appWith(dist).request("/api/tasks");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { served: true });
    const internal = await appWith(dist).request("/internal/sessions/s1/events", {
      method: "POST",
    });
    assert.deepEqual(await internal.json(), { served: true });
  });

  it("NEVER renders the screen under /webhooks, the only prefix exposed to the Internet", async () => {
    // Caught by the webhooks lot's architecture review (03/09): /webhooks is public through the
    // funnel, and without the reservation an anonymous GET got the whole UI.
    for (const url of ["/webhooks/anything", "/webhooks", "/webhooks/github"]) {
      const res = await appWith(dist).request(url);
      assert.equal(res.status, 404, url);
      assert.doesNotMatch(await res.text(), /<div id="root">/, url);
    }
  });

  it("does NOT render the screen on an unknown API route", async () => {
    // A 200 HTML on an API call shows "Unexpected token <" and the real status disappears.
    for (const url of ["/api/not-a-route", "/api", "/internal/sessions/s1/unknown"]) {
      const res = await appWith(dist).request(url);
      assert.equal(res.status, 404, url);
      assert.doesNotMatch(await res.text(), /<div id="root">/, url);
    }
  });

  it("does not leave the build folder, even through an encoded traversal", async () => {
    // `%2e%2e` decodes to `..` AFTER routing, bypassing URL normalisation. The target really exists
    // two levels above a real `web/dist`.
    const res = await appWith(dist).request("/%2e%2e/%2e%2e/package.json");
    assert.doesNotMatch(await res.text(), /"name"/);
  });
});

describe("everyday development, without a build", () => {
  it("returns the service card at the root and nothing else", async () => {
    const app = appWith(sansBuild);
    const res = await app.request("/");
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { service: string }).service, "legion-control-plane");
  });

  it("mounts NO fallback: a view URL stays 404", async () => {
    // A fallback mounted on nothing would also 404, but after reading the disk on every request.
    const res = await appWith(sansBuild).request("/tasks/abc123/diff");
    assert.equal(res.status, 404);
  });

  it("leaves served routes intact", async () => {
    const res = await appWith(sansBuild).request("/api/tasks");
    assert.deepEqual(await res.json(), { served: true });
  });
});
