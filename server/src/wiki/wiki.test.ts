// The three rules that make a wiki a wiki and not a folder of files:
//  1. Links are tolerant. `[[Agent]]`, `[[concepts/agent]]` and `[[Concepts/Agent]]` lead to the
//     same place; if writing a link means remembering the tree, nobody writes links.
//  2. A dead link stays visible. It is the list of pages still to write.
//  3. A path is never concatenated. An outside slug is compared to the inventory, so traversal is
//     impossible by construction, not by a filter the next refactor forgets.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseLinks, resolveSlug, slugOf, titleOf, type WikiEntry } from "./wiki.js";

const dir = mkdtempSync(join(tmpdir(), "legion-wiki-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function entry(slug: string, title = slug): WikiEntry {
  return {
    slug,
    title,
    section: slug.includes("/") ? slug.split("/").slice(0, -1).join("/") : "",
    bytes: 10,
  };
}

describe("slugOf / titleOf", () => {
  it("the slug is the path without extension, lower-cased", () => {
    assert.equal(slugOf("Concepts/Agent.md"), "concepts/agent");
    assert.equal(slugOf("Home.md"), "home");
  });

  it("the title is the first H1, no frontmatter to learn", () => {
    assert.equal(titleOf("# An agent\n\ntext", "concepts/agent.md"), "An agent");
  });

  it("without an H1, the title falls back to the file name", () => {
    assert.equal(titleOf("no title here", "concepts/agent.md"), "agent");
  });
});

describe("parseLinks", () => {
  it("reads [[target]] and [[target|label]]", () => {
    const links = parseLinks("see [[Agent]] and [[concepts/session|the session]]");
    assert.deepEqual(links, [
      { target: "agent", label: "Agent", hasLabel: false },
      { target: "concepts/session", label: "the session", hasLabel: true },
    ]);
  });

  // Without `hasLabel`, `[[concepts/agent]]` rendered as its path instead of its title,
  // and the whole corpus read as file paths. The first screenshot showed exactly that.
  it("tells a link WITHOUT a label from one whose label equals the target", () => {
    assert.equal(parseLinks("[[agent]]")[0]!.hasLabel, false);
    assert.equal(parseLinks("[[agent|agent]]")[0]!.hasLabel, true);
  });

  it("deduplicates: a page cited three times makes one link", () => {
    assert.equal(parseLinks("[[Agent]] then [[Agent]] again [[Agent]]").length, 1);
  });

  it("keeps TWO entries when the same link carries two different labels", () => {
    // The renderer must be able to write both wordings: the text is what shows on screen.
    assert.equal(parseLinks("[[agent|an agent]] and [[agent|the agents]]").length, 2);
  });

  it("ignores single brackets: [this](https://x) is not a wikilink", () => {
    assert.deepEqual(parseLinks("a [normal link](https://example.com) and some [text]"), []);
  });
});

describe("resolveSlug: the tolerance that makes links writable", () => {
  const entries = [entry("home"), entry("concepts/agent"), entry("concepts/session")];

  it("finds by exact path", () => {
    assert.equal(resolveSlug("concepts/agent", entries)?.slug, "concepts/agent");
  });

  it("finds by BARE NAME, without remembering the tree", () => {
    assert.equal(resolveSlug("agent", entries)?.slug, "concepts/agent");
  });

  it("ignores case and extra slashes", () => {
    assert.equal(resolveSlug("/Concepts/Agent/", entries)?.slug, "concepts/agent");
  });

  it("returns null for a page that does not exist: the dead link is information", () => {
    assert.equal(resolveSlug("environments", entries), null);
  });

  it("the exact path WINS over the bare name", () => {
    // Otherwise creating a root `agent.md` would hijack every `[[concepts/agent]]` already
    // written: a link must not change target under the reader's feet.
    const withRoot = [entry("agent"), ...entries];
    assert.equal(resolveSlug("concepts/agent", withRoot)?.slug, "concepts/agent");
  });
});

describe("getPage: traversal is impossible by construction", () => {
  it("a slug climbing the tree returns NOTHING, it does not read a neighbouring file", async () => {
    const wiki = join(dir, "docs", "wiki");
    mkdirSync(wiki, { recursive: true });
    writeFileSync(join(wiki, "home.md"), "# Home\n");
    writeFileSync(join(dir, "secret.md"), "# Must never leak\n");
    // WIKI_DIR is fixed at import, so we check the property on the real module: a hostile slug
    // matches no inventory entry, so no path is ever built from it.
    const { getPage } = await import("./wiki.js");
    for (const hostile of ["../../.env", "../../../etc/passwd", "..%2F..%2Fsecret", "/etc/passwd"])
      assert.equal(getPage(hostile), null, `hostile slug accepted: ${hostile}`);
  });
});
