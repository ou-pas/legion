// Protects:
//
//  1. a tool name outside the allowlist is refused and named, never silently filtered;
//  2. base SDK tools and internal mcp__legion__* tools are accepted as-is;
//  3. an mcp__<server> prefix is accepted only for a server actually granted to the agent;
//  4. an agent with inboxAccess=true losing its two inbox tools is refused by name;
//  5. DEFAULT_TOOLS passes its own validation for any inboxAccess.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGION_MCP_TOOLS,
  BASE_SDK_TOOLS,
  DEFAULT_TOOLS,
  HARNESS_TOOLS,
  REQUIRED_INBOX_TOOLS,
  resolveBuiltinTools,
  resolveAgentTools,
  validateAllowedTools,
} from "./tool-grants.js";

describe("validateAllowedTools, allowlist", () => {
  it("accepts base SDK tools", () => {
    const r = validateAllowedTools([...BASE_SDK_TOOLS], {
      inboxAccess: false,
      grantedMcpServerNames: [],
    });
    assert.deepEqual(r, { ok: true });
  });

  it("accepts internal mcp__legion__* tools", () => {
    const r = validateAllowedTools([...LEGION_MCP_TOOLS], {
      inboxAccess: true,
      grantedMcpServerNames: [],
    });
    assert.deepEqual(r, { ok: true });
  });

  it("refuses an unknown name and names it in the error", () => {
    // `NotebookEdit` exists in the SDK but not here: a plausible name never reviewed for
    // networking, exactly what the allowlist targets.
    const r = validateAllowedTools(["Bash", "NotebookEdit"], {
      inboxAccess: false,
      grantedMcpServerNames: [],
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.match(r.error, /NotebookEdit/);
  });

  it("accepts WebSearch and WebFetch (decision D18)", () => {
    assert.deepEqual(
      validateAllowedTools(["Bash", "WebSearch", "WebFetch"], {
        inboxAccess: false,
        grantedMcpServerNames: [],
      }),
      { ok: true },
    );
    // Allowed does not mean default: an agent without explicit `allowedTools` has no web access.
    assert.equal(DEFAULT_TOOLS.includes("WebSearch"), false);
    assert.equal(DEFAULT_TOOLS.includes("WebFetch"), false);
  });

  it("refuses an mcp__<server> prefix for a server not granted to this agent", () => {
    const r = validateAllowedTools(["mcp__github"], {
      inboxAccess: false,
      grantedMcpServerNames: ["linear"],
    });
    assert.equal(r.ok, false);
  });

  it("accepts mcp__<server> (whole server) for a granted server", () => {
    const r = validateAllowedTools(["Bash", "mcp__github"], {
      inboxAccess: false,
      grantedMcpServerNames: ["github"],
    });
    assert.deepEqual(r, { ok: true });
  });

  it("accepts mcp__<server>__<tool> for a granted server", () => {
    const r = validateAllowedTools(["mcp__github__create_issue"], {
      inboxAccess: false,
      grantedMcpServerNames: ["github"],
    });
    assert.deepEqual(r, { ok: true });
  });

  it("does not mistake a partial prefix for the granted server (mcp__githubx is not github)", () => {
    const r = validateAllowedTools(["mcp__githubx__create_issue"], {
      inboxAccess: false,
      grantedMcpServerNames: ["github"],
    });
    assert.equal(r.ok, false);
  });
});

describe("validateAllowedTools, consistency with inboxAccess", () => {
  it("refuses by name an allowedTools without both inbox tools while inboxAccess is on", () => {
    const r = validateAllowedTools(["Bash"], { inboxAccess: true, grantedMcpServerNames: [] });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.match(r.error, /inboxAccess/);
  });

  it("refuses when only one of the two inbox tools is missing", () => {
    const r = validateAllowedTools(["Bash", "mcp__legion__inbox_ask"], {
      inboxAccess: true,
      grantedMcpServerNames: [],
    });
    assert.equal(r.ok, false);
  });

  it("accepts when both inbox tools are present", () => {
    const r = validateAllowedTools(["Bash", ...REQUIRED_INBOX_TOOLS], {
      inboxAccess: true,
      grantedMcpServerNames: [],
    });
    assert.deepEqual(r, { ok: true });
  });

  it("requires nothing inbox-related when inboxAccess is off", () => {
    const r = validateAllowedTools(["Bash"], { inboxAccess: false, grantedMcpServerNames: [] });
    assert.deepEqual(r, { ok: true });
  });
});

describe("DEFAULT_TOOLS", () => {
  it("passes its own validation, with or without inboxAccess", () => {
    assert.deepEqual(
      validateAllowedTools(DEFAULT_TOOLS, { inboxAccess: true, grantedMcpServerNames: [] }),
      { ok: true },
    );
    assert.deepEqual(
      validateAllowedTools(DEFAULT_TOOLS, { inboxAccess: false, grantedMcpServerNames: [] }),
      { ok: true },
    );
  });

  it("contains both required inbox tools", () => {
    for (const t of REQUIRED_INBOX_TOOLS) assert.ok(DEFAULT_TOOLS.includes(t));
  });
});

describe("resolveAgentTools", () => {
  it("falls back to DEFAULT_TOOLS without explicit allowedTools (NULL column)", () => {
    assert.deepEqual(resolveAgentTools({ allowedTools: null }), DEFAULT_TOOLS);
  });

  it("uses the agent's declared set as-is, without merging the default", () => {
    assert.deepEqual(resolveAgentTools({ allowedTools: JSON.stringify(["Bash"]) }), ["Bash"]);
  });
});

// The SDK's `allowedTools` only skips confirmation; `tools` restricts. Until it was set, the whole
// `claude_code` preset was available to every agent (08/09: `Agent` called seven times and
// `WebSearch` twice by agents with neither).
describe("resolveBuiltinTools, exposure rather than auto-approval", () => {
  it("drops MCP names: `tools` covers built-in tools only", () => {
    const out = resolveBuiltinTools(["Bash", "mcp__legion__fs_read", "mcp__linear"]);
    assert.deepEqual(
      out.filter((t) => t.startsWith("mcp__")),
      [],
      "MCP servers go through `mcpServers` and stay guarded by `allowedTools`",
    );
    assert.ok(out.includes("Bash"));
  });

  it("adds the harness plumbing, which is nobody's grant", () => {
    const out = resolveBuiltinTools(["Bash"]);
    for (const t of HARNESS_TOOLS)
      assert.ok(out.includes(t), `${t} missing: the machine does not run without it`);
    for (const t of HARNESS_TOOLS)
      assert.equal(
        DEFAULT_TOOLS.includes(t),
        false,
        `${t} is not a grant: an operator neither chooses nor removes it`,
      );
  });

  it("does not grant web tools to an agent that did not declare them", () => {
    const out = resolveBuiltinTools(DEFAULT_TOOLS);
    assert.equal(out.includes("WebSearch"), false);
    assert.equal(out.includes("WebFetch"), false);
    assert.ok(
      resolveBuiltinTools([...DEFAULT_TOOLS, "WebSearch"]).includes("WebSearch"),
      "and stays grantable when the agent declares it",
    );
  });

  it("returns no duplicate, even when a grant overlaps the plumbing", () => {
    const out = resolveBuiltinTools(["Bash", "Bash", "Skill"]);
    assert.equal(new Set(out).size, out.length);
  });
});

// 08/09, operator decision: any agent may fan out sub-agents, with no cap.
describe("Agent", () => {
  it("is in the default set", () => {
    assert.ok(DEFAULT_TOOLS.includes("Agent"));
    assert.ok(resolveBuiltinTools(resolveAgentTools({ allowedTools: null })).includes("Agent"));
  });

  it("comes with the means to collect what it launches", () => {
    // `Agent` starts sub-agents in the background by default: without `TaskOutput` a fan-out
    // never comes back.
    assert.ok(resolveBuiltinTools(["Agent"]).includes("TaskOutput"));
  });

  it("passes the allowlist, so the capabilities API accepts it", () => {
    assert.deepEqual(
      validateAllowedTools(["Agent"], { inboxAccess: false, grantedMcpServerNames: [] }),
      { ok: true },
    );
  });
});
