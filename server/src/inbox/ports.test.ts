// An unwired port must say so (06/09). Only `index.ts` calls `registerSessionResumer`; if the app
// is ever assembled another way, the first symptom would be a recorded answer whose session never
// restarts. The port refuses and says exactly what to do.
import assert from "node:assert/strict";
import { it } from "node:test";

import { registerSessionResumer, sessionResumer } from "./ports.js";

it("SessionResumer: unwired, refuses and names the assembly step", () => {
  assert.throws(() => sessionResumer(), /index.ts must call registerSessionResumer/);
});

it("SessionResumer: wired, returns the registered implementation", async () => {
  const seen: string[] = [];
  registerSessionResumer({
    resume: async (sessionId) => {
      seen.push(`resume:${sessionId}`);
    },
    run: async (taskId) => {
      seen.push(`run:${taskId}`);
      return "s1";
    },
  });
  await sessionResumer().resume("s1", "yes", {});
  assert.equal(await sessionResumer().run("t1"), "s1");
  assert.deepEqual(seen, ["resume:s1", "run:t1"]);
});
