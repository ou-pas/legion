// The text of the SKILLS registry: the folder drop zone, what it refuses, and the list.
import { defineText } from "../../i18n/catalog.js";
import { UI_TEXT } from "../../ui/vocabulary.js";
import { plural } from "../../ui/plural.js";

export const SKILLS_TEXT = defineText({
  title: UI_TEXT.permission.scope.skills,

  /** The description and the dropzone hint wrap file names (`SKILL.md`, `name:`) quoted in `code`
   *  by the component: the sentence comes in PIECES, otherwise extraction would swallow the inline
   *  elements and change the rendering. */
  descBeforeFile: "A skill folder (or a",
  descAfterFile:
    "on its own) dropped here joins the project library; each agent then reaches it checkbox by checkbox on the Agents page.",
  dropLabel: "Drop a skill folder here (or click to choose a folder)",
  dropHintBeforeFile: "The folder gives the skill its name; a",
  dropHintBeforeKey: "on its own takes its frontmatter",
  dropHintEnd: ".",

  /** The file chips stop at eight — the rest is counted. */
  morePending: (n: number) => `+${n} more`,
  uploaded: (name: string, files: number) =>
    `Skill “${name}” uploaded (${files} ${plural(files, "file")}).`,
  noFrontmatterName: "SKILL.md without a `name:` frontmatter — drop the whole folder instead.",
  notASkill: "Drop a skill folder (or a SKILL.md on its own).",

  emptyTitle: "No skill in this project",
  emptyBody:
    "A skill is a reusable folder of instructions — drop one above so your agents can reach it.",
  listLabel: "Project skills",
  delete: "Delete the skill (also removes the agents' grants)",
  /** Same wording as on a rule or an MCP server: it is the same checkbox, and it writes a column
   *  of the CURRENT PROJECT — "all agents" did not say so. */
  allAgents: "default for this project",

  /** Reading a skill BEFORE granting it (24/08): it enters an agent's prompt, and judging it on
   *  two lines of description was signing blind. */
  read: "Read the skill",
  collapse: "Collapse the skill",

  /** The expanded content: its SKILL.md, and an inventory of what else it ships. */
  viewer: {
    loading: "reading the skill…",
    label: (name: string) => `Content of skill ${name}`,
    noEntryPoint: "this folder has no SKILL.md — agents will find no entry point in it",
    truncated: "content truncated on screen — the whole file goes into the session intact",
    others: (n: number) => `${n} ${plural(n, "more file")} bundled`,
    more: (n: number) => `+${n} more`,
    /** "4.2 kB" — the weight of a file reads at a glance. */
    size: (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} kB`,
  },
});
