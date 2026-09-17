import { json } from "./client.js";

export interface WikiEntry {
  slug: string;
  title: string;
  /** The folder, "" at the root: it groups the table of contents. */
  section: string;
  bytes: number;
}

export interface WikiLink {
  target: string;
  /** Already resolved by the server: for a `[[target]]` without a label, the target page's TITLE,
   *  not its path. */
  label: string;
  /** null = dead link. Still rendered, struck through: it says which page is left to write. */
  resolved: string | null;
}

export interface WikiPage extends WikiEntry {
  content: string;
  truncated: boolean;
  links: WikiLink[];
  backlinks: WikiEntry[];
}

export const wikiApi = {
  index: (): Promise<{ pages: WikiEntry[] }> => fetch("/api/wiki").then(json),
  page: (slug: string): Promise<WikiPage> =>
    fetch(`/api/wiki/${slug.split("/").map(encodeURIComponent).join("/")}`).then(json),
};
