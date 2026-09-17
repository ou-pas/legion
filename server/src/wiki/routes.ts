// Wiki routes: Legion's documentation, read from docs/wiki/.
// Read-only: the wiki is edited in the repo, under review, like the code it describes.
import { Hono } from "hono";
import { backlinksOf, getPage, listPages, resolveSlug } from "./wiki.js";

export function registerWikiRoutes(app: Hono): void {
  /** The table of contents only: page bodies are not sent here. */
  app.get("/api/wiki", (c) => c.json({ pages: listPages() }));

  /** One page, with its links resolved and its backlinks. Resolution happens server-side, where
   *  the inventory lives, so the browser never refetches the list to learn that `[[Agent]]`
   *  means `concepts/agent`. */
  app.get("/api/wiki/:slug{.+}", (c) => {
    const page = getPage(c.req.param("slug"));
    if (!page) return c.json({ error: "page not found" }, 404);
    const entries = listPages();
    return c.json({
      ...page,
      // A dead link stays visible (`resolved: null`): it tells which page is still to write.
      links: page.links.map((l) => {
        const hit = resolveSlug(l.target, entries);
        return {
          ...l,
          resolved: hit?.slug ?? null,
          // `[[concepts/agent]]` must display the page title, not the path.
          label: l.hasLabel ? l.label : (hit?.title ?? l.label),
        };
      }),
      backlinks: backlinksOf(page.slug, entries),
    });
  });
}
