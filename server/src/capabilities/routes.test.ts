// Wiring of PATCH /api/agents/:id for `allowedTools` (the rule itself is in tool-grants.test.ts):
// the route calls it with the right context (the agent's inboxAccess, the MCP servers actually
// granted) and answers with the expected codes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-capabilities-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerCapabilityRoutes } = await import("./routes.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerCapabilityRoutes(app);

const patch = (path: string, body: unknown) =>
  app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const P1 = "p1";
const A_INBOX = "a-inbox"; // inboxAccess: true (default)
const A_NO_INBOX = "a-no-inbox";
const MCP_GITHUB = "mcp-github";
const MCP_SLACK_ALL = "mcp-slack-all"; // allAgents: true

beforeEach(() => {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.mcpServers).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values([
      {
        id: A_INBOX,
        projectId: P1,
        name: "inbox-agent",
        rolePrompt: "r",
        inboxAccess: true,
        createdAt: now,
      },
      {
        id: A_NO_INBOX,
        projectId: P1,
        name: "no-inbox-agent",
        rolePrompt: "r",
        inboxAccess: false,
        createdAt: now,
      },
    ])
    .run();
  db.insert(schema.mcpServers)
    .values([
      {
        id: MCP_GITHUB,
        projectId: P1,
        name: "github",
        config: JSON.stringify({ type: "stdio", command: "x" }),
        createdAt: now,
      },
      {
        id: MCP_SLACK_ALL,
        projectId: P1,
        name: "slack",
        config: JSON.stringify({ type: "stdio", command: "x" }),
        allAgents: true,
        createdAt: now,
      },
    ])
    .run();
});

const agentRow = (id: string) =>
  db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();

describe("PATCH /api/agents/:id, allowedTools", () => {
  it("refuses a tool outside the allowlist, named in the error (400)", async () => {
    // A name the server never vetted (`WebFetch` is allowed since D18).
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      allowedTools: ["Bash", "NotebookEdit"],
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /NotebookEdit/);
    assert.equal(agentRow(A_NO_INBOX)?.allowedTools, null); // nothing written on refusal
  });

  it("refuses an mcp__<server> prefix for a server not granted to this agent (400)", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: ["mcp__github"] });
    assert.equal(res.status, 400);
  });

  it("accepts mcp__<server> once the server is granted in the same request", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      mcpServerIds: [MCP_GITHUB],
      allowedTools: ["Bash", "mcp__github"],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(agentRow(A_NO_INBOX)?.allowedTools ?? "null"), [
      "Bash",
      "mcp__github",
    ]);
  });

  it("refuses by name removing inbox tools from an agent with inboxAccess on (400)", async () => {
    const res = await patch(`/api/agents/${A_INBOX}`, { allowedTools: ["Bash"] });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /inboxAccess/);
    assert.equal(agentRow(A_INBOX)?.allowedTools, null);
  });

  it("accepts removing inbox tools from an agent without inboxAccess", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: ["Bash"] });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(agentRow(A_NO_INBOX)?.allowedTools ?? "null"), ["Bash"]);
  });

  it("accepts a valid allowedTools with inbox tools for an inboxAccess agent", async () => {
    const res = await patch(`/api/agents/${A_INBOX}`, {
      allowedTools: ["Bash", "mcp__legion__inbox_ask", "mcp__legion__inbox_send"],
    });
    assert.equal(res.status, 200);
  });

  it("`allowedTools: null` puts the agent back on the default set, with no validation", async () => {
    await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: ["Bash"] });
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: null });
    assert.equal(res.status, 200);
    assert.equal(agentRow(A_NO_INBOX)?.allowedTools, null);
  });

  it("rejects a malformed allowedTools (not an array of strings)", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: [42] });
    assert.equal(res.status, 400);
  });

  it("404 on an unknown agent", async () => {
    const res = await patch(`/api/agents/nope`, { allowedTools: ["Bash"] });
    assert.equal(res.status, 404);
  });

  it("accepts mcp__<server> for an allAgents=true server not in mcpServerIds", async () => {
    // v35: an "all agents" server is granted to every agent of the project, so validation must
    // include it.
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { allowedTools: ["Bash", "mcp__slack"] });
    assert.equal(
      res.status,
      200,
      "allowedTools should accept mcp__slack when slack has allAgents=true",
    );
    assert.deepEqual(JSON.parse(agentRow(A_NO_INBOX)?.allowedTools ?? "null"), [
      "Bash",
      "mcp__slack",
    ]);
  });

  it("accepts mcp__<server>__<tool> for an allAgents=true server", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      allowedTools: ["Bash", "mcp__slack__send_message"],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(agentRow(A_NO_INBOX)?.allowedTools ?? "null"), [
      "Bash",
      "mcp__slack__send_message",
    ]);
  });
});

// The role is written only with the rest of the patch (05/09): a half-valid body used to persist
// the role before answering 400. Everything is validated, then everything is written, or nothing.
describe("PATCH /api/agents/:id, rolePrompt", () => {
  it("valid role and invalid effort: 400, stored role unchanged", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      rolePrompt: "new role",
      effort: "bogus",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /effort/);
    assert.equal(agentRow(A_NO_INBOX)?.rolePrompt, "r");
  });

  it("empty role and valid grant: 400, grant not written", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      rolePrompt: "   ",
      browserAccess: true,
    });
    assert.equal(res.status, 400);
    assert.equal(agentRow(A_NO_INBOX)?.browserAccess, false);
  });

  it("live session on the agent: 409, neither role nor grant written", async () => {
    const now = new Date();
    db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.process }).run();
    db.insert(schema.tasks)
      .values({
        id: "t1",
        projectId: P1,
        name: "t",
        assigneeAgentId: A_NO_INBOX,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: "t1",
        agentId: A_NO_INBOX,
        runnerId: "r1",
        model: "sonnet",
        status: "running",
        callbackToken: "tok",
        startedAt: now,
      })
      .run();
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      rolePrompt: "new role",
      browserAccess: true,
    });
    assert.equal(res.status, 409);
    assert.equal(agentRow(A_NO_INBOX)?.rolePrompt, "r");
    assert.equal(agentRow(A_NO_INBOX)?.browserAccess, false);
  });

  it("role alone is a valid patch: 200, written trimmed", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, { rolePrompt: "  new role  \n" });
    assert.equal(res.status, 200);
    assert.equal(agentRow(A_NO_INBOX)?.rolePrompt, "new role");
  });

  it("role and grant in one body: both written", async () => {
    const res = await patch(`/api/agents/${A_NO_INBOX}`, {
      rolePrompt: "new role",
      browserAccess: true,
    });
    assert.equal(res.status, 200);
    assert.equal(agentRow(A_NO_INBOX)?.rolePrompt, "new role");
    assert.equal(agentRow(A_NO_INBOX)?.browserAccess, true);
  });
});

describe("GET /api/tool-catalog", () => {
  const get = (path: string) => app.request(path);

  it("exposes the full tool catalogue (200)", async () => {
    const res = await get("/api/tool-catalog");
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert(body.baseSdkTools);
    assert(body.webTools);
    assert(body.legionMcpTools);
    assert(body.defaultTools);
    assert(body.requiredInboxTools);
    assert(body.inboxGatedTools);
  });

  it("contains the base SDK tools", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    // `Agent` since 08/09: any agent may fan out sub-agents, with no cap.
    assert.deepEqual(body.baseSdkTools, ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent"]);
  });

  it("contains the web tools (WebSearch, WebFetch) outside the default set", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.webTools, ["WebSearch", "WebFetch"]);
    assert(!((body.defaultTools as string[]) ?? []).includes("WebSearch"));
    assert(!((body.defaultTools as string[]) ?? []).includes("WebFetch"));
  });

  it("contains Legion's internal MCP tools", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    assert(Array.isArray(body.legionMcpTools));
    assert((body.legionMcpTools as string[]).length > 0);
    assert((body.legionMcpTools as string[]).every((t: string) => t.startsWith("mcp__legion__")));
  });

  it("DEFAULT_TOOLS combines baseSdkTools and legionMcpTools", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    const expected = [...(body.baseSdkTools as string[]), ...(body.legionMcpTools as string[])];
    assert.deepEqual(body.defaultTools, expected);
  });

  it("REQUIRED_INBOX_TOOLS contains both inbox tools", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.requiredInboxTools, [
      "mcp__legion__inbox_ask",
      "mcp__legion__inbox_send",
    ]);
  });

  it("INBOX_GATED_TOOLS are the tools gated by inboxAccess", async () => {
    const res = await get("/api/tool-catalog");
    const body = (await res.json()) as Record<string, unknown>;
    assert(Array.isArray(body.inboxGatedTools));
    assert((body.inboxGatedTools as string[]).length > 0);
    assert((body.inboxGatedTools as string[]).every((t: string) => t.startsWith("mcp__legion__")));
  });
});
