// Protects:
//
//  1. The config never goes back to the screen: it may hold a plain token, and a URL may carry one
//     in its query string. The view returns the server's shape, never its content.
//  2. Two same-named servers in a project would overwrite each other in the session spec
//     (review 5b #7); the second is refused with 409.
//  3. The transport requires its field (URL for http/sse, command for stdio), or the server is
//     saved and never starts.
//  4. Deleting a server clears its grants.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-mcp-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { createMcpServer, deleteMcpServer, listMcpServers, setMcpServerAllAgents } =
  await import("./mcp-edit.js");

const P1 = "p1";
const P2 = "p2";

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.mcpServers).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: P2, name: "P2", slug: "p2", createdAt: now },
    ])
    .run();
});

const stdio = { projectId: P1, name: "github", config: { command: "npx github-mcp" } };

describe("createMcpServer, what a server needs to start", () => {
  it("saves a stdio server and never returns its config", () => {
    const result = createMcpServer({ ...stdio });
    assert.equal(result.ok, true);
    assert.equal("config" in result.server, false);
    assert.equal(result.server.name, "github");
  });

  it("refuses stdio without a command", () => {
    const result = createMcpServer({ projectId: P1, name: "empty", config: { type: "stdio" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /command/);
  });

  it("refuses http without a URL, and an unreadable URL", () => {
    const noUrl = createMcpServer({ projectId: P1, name: "http1", config: { type: "http" } });
    assert.equal(noUrl.ok, false);
    assert.match(noUrl.error, /url required/);
    const badUrl = createMcpServer({
      projectId: P1,
      name: "http2",
      config: { type: "http", url: "not-a-url" },
    });
    assert.equal(badUrl.ok, false);
    assert.match(badUrl.error, /invalid config\.url/);
  });

  it("refuses a namesake in the same project (409), accepts it in another", () => {
    assert.equal(createMcpServer({ ...stdio }).ok, true);
    const dup = createMcpServer({ ...stdio });
    assert.equal(dup.ok, false);
    assert.equal(dup.status, 409);
    assert.equal(createMcpServer({ ...stdio, projectId: P2 }).ok, true);
  });
});

describe("listMcpServers, the shape never the content", () => {
  it("hides a URL's query string so a pasted token does not reach the UI", () => {
    createMcpServer({
      projectId: P1,
      name: "sse",
      config: { type: "sse", url: "https://example.test/mcp?token=secret" },
    });
    const [view] = listMcpServers(P1);
    assert.equal(view?.url, "https://example.test/mcp");
    assert.equal(JSON.stringify(view).includes("secret"), false);
  });

  it("returns a stdio server's command and no URL", () => {
    createMcpServer({ ...stdio });
    const [view] = listMcpServers(P1);
    assert.equal(view?.type, "stdio");
    assert.equal(view?.url, null);
    assert.equal(view?.command, "npx github-mcp");
  });

  it("filters by project, or returns everything when none is given", () => {
    createMcpServer({ ...stdio });
    createMcpServer({ ...stdio, projectId: P2 });
    assert.equal(listMcpServers(P1).length, 1);
    assert.equal(listMcpServers(undefined).length, 2);
  });
});

describe("setMcpServerAllAgents / deleteMcpServer", () => {
  it("404 on an unknown server", () => {
    assert.deepEqual(setMcpServerAllAgents("never", true), {
      ok: false,
      status: 404,
      error: "server not found",
    });
  });

  it('toggles the "all agents" checkbox', () => {
    const created = createMcpServer({ ...stdio });
    assert.equal(created.ok, true);
    assert.equal(setMcpServerAllAgents(created.server.id, true).ok, true);
    assert.equal(listMcpServers(P1)[0]?.allAgents, true);
  });

  it("removes the deleted server from the agents referencing it", () => {
    const created = createMcpServer({ ...stdio });
    assert.equal(created.ok, true);
    db.insert(schema.agents)
      .values({
        id: "a1",
        projectId: P1,
        name: "a",
        rolePrompt: "r",
        createdAt: new Date(),
        mcpServerIds: JSON.stringify([created.server.id]),
      })
      .run();
    deleteMcpServer(created.server.id);
    assert.equal(listMcpServers(P1).length, 0);
    const agent = db.select().from(schema.agents).where(eq(schema.agents.id, "a1")).get();
    assert.deepEqual(JSON.parse(agent?.mcpServerIds ?? "[]"), []);
  });
});
