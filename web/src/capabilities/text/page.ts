// The text of the LIBRARY page ("Capabilities" until 12/09 — the word covered both this screen
// and, in the wiki, what is granted to an agent; it keeps its single meaning, the wiki's, cf.
// `docs/wiki/guides/capacites.md`): its header, the banner shown when no project is picked, and
// the tabs of the five registries. The sections themselves carry their own catalog
// (`text/skills.ts`, `text/rules.ts`, `text/mcp.ts`, `text/environments.ts`) — one registry, one
// module.
//
// The words the grant vocabulary already carries (`UI_TEXT.permission.scope`) are REUSED, not
// copied: a registry and the scope that grants it name the same thing, and two copies would drift
// apart at the first change of word. That is why the "MCP" row lines up here with the title of its
// card, "MCP servers" (`McpSection.tsx`): one word for one object.
import { defineText } from "../../i18n/catalog.js";
import { UI_TEXT } from "../../ui/vocabulary.js";

export const CAPABILITIES_PAGE_TEXT = defineText({
  title: "Library",
  sub: "The project's libraries — granting them per agent happens on the Agents page.",

  /** Without a project, four registries out of five have no object: the banner says which one is
   *  left. */
  noProjectTitle: "No project selected",
  noProjectBody:
    "Rules, chains, MCP servers and environments belong to a project: pick one in the left rail to manage them. Skills are common to the whole installation.",

  /** The five REGISTRIES. They used to be tabs; they are routes since slice nav/09, and these
   *  words now name three things at once — the rail row, the screen title and the document title.
   *  The tab bar's label went with the bar. */
  tabs: {
    skills: UI_TEXT.permission.scope.skills,
    rules: UI_TEXT.permission.scope.rules,
    /** Chains live in their own domain (`chains/`): only the TAB belongs here. */
    chains: "Chains",
    mcp: UI_TEXT.permission.scope.mcp,
    environments: "Environments",
  },
});
