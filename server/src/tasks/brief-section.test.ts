import { test } from "node:test";
import assert from "node:assert/strict";
import { briefBefore } from "./brief-section.js";

const HEADINGS = ["\n\n## CI fix", "\n\n## Correction de la CI"];

test("briefBefore: no section, the brief is returned whole", () => {
  assert.equal(briefBefore("brief", HEADINGS), "brief");
});

test("briefBefore: cuts at the legacy heading as well as the current one", () => {
  assert.equal(briefBefore("brief\n\n## Correction de la CI (old)\nx", HEADINGS), "brief");
  assert.equal(briefBefore("brief\n\n## CI fix (new)\nx", HEADINGS), "brief");
});

test("briefBefore: cuts at the earliest of several headings", () => {
  assert.equal(
    briefBefore("brief\n\n## CI fix\na\n\n## Correction de la CI\nb", HEADINGS),
    "brief",
  );
  assert.equal(
    briefBefore("brief\n\n## Correction de la CI\na\n\n## CI fix\nb", HEADINGS),
    "brief",
  );
});
