// The spec's pure decisions (lot 11), made without database, disk or docker, which used to be taken
// in the middle of `buildSpec`. `buildSpec` itself is exercised end to end elsewhere
// (manager.test.ts, payload-spec.test.ts, attachments-spec.test.ts, read-only-task.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HARNESS_TOOLS,
  INBOX_GATED_TOOLS,
  LEGION_MCP_TOOLS,
  REQUIRED_INBOX_TOOLS,
} from "../../capabilities/tool-grants.js";
import {
  browserForSession,
  effectiveRepoAccess,
  exposedTools,
  sessionCallbackUrl,
} from "./spec.js";

describe("sessionCallbackUrl: the address the container calls back", () => {
  const envKeys = ["LEGION_CALLBACK_URL", "PORT"] as const;
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };

  it("the RUNNER's address wins: the v51 multi-machine fix", () => {
    // `LEGION_CALLBACK_URL` is global, so it cannot be right for two machines at once. A container
    // on the Mac mini calling back `localhost` calls the Mac mini, where there is no control plane,
    // and the session goes silent forever.
    process.env.LEGION_CALLBACK_URL = "http://global:1234";
    try {
      assert.equal(
        sessionCallbackUrl({ callbackUrl: "http://mini-atelier:8790" }),
        "http://mini-atelier:8790",
      );
    } finally {
      restore();
    }
  });

  it("without an address on the runner, the global variable takes over", () => {
    process.env.LEGION_CALLBACK_URL = "http://global:1234";
    try {
      assert.equal(sessionCallbackUrl({ callbackUrl: null }), "http://global:1234");
    } finally {
      restore();
    }
  });

  it("with nothing, the local port, exactly as before v51", () => {
    delete process.env.LEGION_CALLBACK_URL;
    process.env.PORT = "9999";
    try {
      assert.equal(sessionCallbackUrl({ callbackUrl: null }), "http://localhost:9999");
    } finally {
      restore();
    }
  });
});

describe("browserForSession: the shared browser is a decision, not provisioning", () => {
  const docker = { id: "r1", kind: "docker" };

  it("granted on a docker runner: the service and its network carry the runner id", () => {
    const b = browserForSession({ browserAccess: true }, docker);
    assert.ok(b, "an agent with the grant must receive a browser");
    assert.match(b.service, /r1/);
    assert.match(b.network, /r1/);
  });

  it("without the grant: nothing, whatever the runner", () => {
    assert.equal(browserForSession({ browserAccess: false }, docker), null);
  });

  it("on a ProcessRunner: nothing, even with the grant", () => {
    // A ProcessRunner has no docker network to offer: the session runs without a browser, without
    // an error, as before the grant.
    assert.equal(browserForSession({ browserAccess: true }, { id: "r2", kind: "process" }), null);
  });
});

describe("effectiveRepoAccess: the session's EFFECTIVE right on its repositories", () => {
  // ONE rule, read by preflight AND the spec: two copies would diverge one day, and preflight would
  // refuse a session the spec had accepted.
  const agent = (repoAccess: string) => ({ repoAccess }) as never;
  const task = (readOnly: boolean) => ({ readOnly }) as never;

  it("a read-only task lowers a write agent to `read` (v53)", () => {
    assert.equal(effectiveRepoAccess(task(true), agent("write")), "read");
  });

  it("it never PROMOTES: an agent without access stays without access", () => {
    assert.equal(effectiveRepoAccess(task(true), agent("none")), "none");
    assert.equal(effectiveRepoAccess(task(false), agent("none")), "none");
  });

  it("outside read-only, the agent's right passes as is", () => {
    assert.equal(effectiveRepoAccess(task(false), agent("write")), "write");
    assert.equal(effectiveRepoAccess(task(false), agent("read")), "read");
  });
});

// What the session may call without being asked (14/09).
//
// Two lists travel in the spec and do different jobs: `builtinTools` EXPOSES, `allowedTools`
// AUTO-ALLOWS. In `permissionMode: "dontAsk"`, a tool exposed but missing from the second does not
// open a question to the human, it gets refused. The harness plumbing was only in the first.
describe("exposedTools: the auto-allow list", () => {
  const agent = (inboxAccess: boolean) => ({ inboxAccess }) as never;

  it("carries the harness plumbing, like the exposure list", () => {
    const out = exposedTools(agent(true), ["Bash"], []);
    for (const tool of HARNESS_TOOLS) assert.ok(out.includes(tool), `${tool} missing`);
  });

  // The inbox gate is this function's reason to exist: it must keep removing what talks to the
  // human, and the plumbing must not become a Trojan horse.
  it("still removes what talks to the human when the inbox is closed", () => {
    const out = exposedTools(
      agent(false),
      ["Bash", "mcp__legion__inbox_ask", "mcp__legion__propose_task"],
      [],
    );
    assert.ok(!out.includes("mcp__legion__inbox_ask"));
    assert.ok(!out.includes("mcp__legion__propose_task"));
    assert.ok(out.includes("Bash"));
  });

  it("names granted MCP servers, whole", () => {
    assert.ok(exposedTools(agent(true), [], ["linear"]).includes("mcp__linear"));
  });

  // Regression: "the agent says it has no access to the artifacts" (diagnostic.md,
  // /artifacts/oa4vlYnCB2/). `coreTools` (runner-payload/mcp-tools.mts) ALWAYS registers these six
  // tools on the "legion" MCP server without reading `allowedTools`, so they are exposed whatever
  // `agentTools` carries. `validateAllowedTools` requires ONLY the two inbox tools, so a custom
  // `agentTools` can omit one of the six. `exposedTools` must add them back to auto-allow, like
  // HARNESS_TOOLS: otherwise the SDK silently refuses an exposed tool (`permissionMode: "dontAsk"`)
  // and the agent can no longer write to its artifacts folder.
  it("the six core tools (fs + update_task) stay auto-allowed even if agentTools lost them", () => {
    const coreTools = LEGION_MCP_TOOLS.filter(
      (t) => !REQUIRED_INBOX_TOOLS.includes(t) && !INBOX_GATED_TOOLS.includes(t),
    );
    const out = exposedTools(agent(true), ["Bash"], []);
    for (const toolName of coreTools) {
      assert.ok(out.includes(toolName), `${toolName} missing from auto-allow`);
    }
  });
});
