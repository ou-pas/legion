// The capabilities domain boundary: what must be refused before reaching the services.
//
//  1. Unknown keys: `{ repoName: [...] }` instead of `repoNames` used to answer 200 and grant
//     nothing. The refusal must name the key.
//  2. Enums come from domain constants, checked against the constant rather than a list written
//     here.
//  3. `null` versus absent: on an agent card, "remove" versus "leave it".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { EFFORT_LEVELS } from "../models/models.js";
import { agentPatchBody, mcpServerBody, rulePatchBody, ruleUpsertBody } from "./schemas.js";

/** A refusal's message, flattened as `parse-body.ts` does for the client. */
const refusal = (schema: z.ZodType, value: unknown): string => {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, false, "this body should have been refused");
  return parsed.error.issues
    .map((i) => [i.path.join("."), i.message].filter(Boolean).join(" — "))
    .join(" · ");
};

describe("schemas, an unknown key is refused and named", () => {
  it("PATCH agent: the typo is cited in the refusal", () => {
    assert.match(refusal(agentPatchBody, { repoName: ["api"] }), /repoName/);
  });

  it("POST rule: a made-up key does not pass silently", () => {
    const body = { projectId: "p1", name: "r", content: "c", scope: "all" };
    assert.match(refusal(ruleUpsertBody, body), /scope/);
  });

  it("POST mcp: an extra key is refused", () => {
    assert.match(
      refusal(mcpServerBody, { projectId: "p1", name: "x", config: {}, extra: 1 }),
      /extra/,
    );
  });
});

describe("schemas, enums come from the domain constants", () => {
  it("refuses a made-up effort, naming the field", () => {
    assert.match(refusal(agentPatchBody, { effort: "bogus" }), /effort/);
  });

  it("accepts every real effort level, without a copied list", () => {
    for (const effort of EFFORT_LEVELS)
      assert.equal(agentPatchBody.safeParse({ effort }).success, true, `effort refused: ${effort}`);
  });

  it("refuses a repository access outside the three", () => {
    assert.match(refusal(agentPatchBody, { repoAccess: "admin" }), /repoAccess/);
  });

  it("refuses an unknown rule status", () => {
    assert.match(refusal(rulePatchBody, { status: "archived" }), /status/);
  });
});

describe("schemas, what the shape says and what it leaves to services", () => {
  it("keeps `null` and absent distinct on an agent card", () => {
    const removed = agentPatchBody.parse({ model: null, allowedTools: null, environmentId: null });
    assert.deepEqual(removed, { model: null, allowedTools: null, environmentId: null });
    assert.deepEqual(agentPatchBody.parse({}), {});
  });

  it("refuses a thinking budget below the API floor", () => {
    assert.match(refusal(agentPatchBody, { thinkingBudget: 512 }), /1024/);
    assert.equal(agentPatchBody.safeParse({ thinkingBudget: 1024 }).success, true);
    assert.equal(agentPatchBody.safeParse({ thinkingBudget: null }).success, true);
  });

  it("refuses an allowedTools that is not an array of strings", () => {
    assert.match(refusal(agentPatchBody, { allowedTools: [42] }), /allowedTools/);
  });

  it("trims an MCP server name and restricts it to tool-prefix characters", () => {
    const ok = mcpServerBody.parse({
      projectId: "p1",
      name: "  github  ",
      config: { command: "x" },
    });
    assert.equal(ok.name, "github");
    assert.match(
      refusal(mcpServerBody, { projectId: "p1", name: "my server", config: {} }),
      /invalid name/,
    );
  });

  it('reserves "legion" for the internal server', () => {
    assert.match(
      refusal(mcpServerBody, { projectId: "p1", name: "legion", config: {} }),
      /reserved/,
    );
  });

  it("refuses a rule without name or content at the boundary", () => {
    assert.match(refusal(ruleUpsertBody, { projectId: "p1", name: "  ", content: "c" }), /name/);
    assert.match(refusal(ruleUpsertBody, { projectId: "p1", name: "r", content: "  " }), /content/);
  });

  it("trims a rule's name and content before the service", () => {
    const parsed = ruleUpsertBody.parse({ projectId: "p1", name: " r ", content: " c \n" });
    assert.equal(parsed.name, "r");
    assert.equal(parsed.content, "c");
  });
});
