// The text of the wiki — same convention as the other domains since the i18n extraction.
import { defineText } from "../i18n/catalog.js";

export const WIKI_TEXT = defineText({
  title: "Wiki",
  sub: "Legion's documentation, served from docs/wiki in the repository.",
  contentsLabel: "Wiki contents",
  rootSection: "General",
  backlinks: "Pages that point here",
  // The rail says which PAGES exist; this column says what is in the one you are reading.
  onThisPage: "On this page",
  deadLink: "this page does not exist yet",
  loading: "Reading the wiki…",
  truncated: "page truncated on screen — the whole file is in the repository",

  indexFailed: "The wiki contents could not be read",
  pageFailed: "This page could not be read",

  // An empty wiki is a legitimate state, not a failure: we say where to drop the first page.
  emptyTitle: "No page in the wiki",
  emptyBody:
    "The wiki fills up by adding .md files under docs/wiki in the repository. Each file becomes a page, and its first level-1 heading gives it its name.",
});
