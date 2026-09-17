// The wiki pages, in the rail rather than a column of their own.
//
// This table of contents used to live inside the screen, as the left pane of a `SplitPane`, right
// against the application rail: two navigation columns side by side. The rail now carries the
// navigation of where you are, and on the wiki this is it.
//
// Grouping by folder is kept as is: it is the only grouping a wiki already has (the file path), and
// inventing another would drift from the repository.
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Book, FileText } from "lucide-react";
import { wikiApi, type WikiEntry } from "../api/wiki.js";
import { NavItem, NavLabel } from "../ui/nav.js";
import { RailHead, RailHeadMark } from "../ui/rail-head.js";
import { WIKI_TEXT } from "./text.js";

const ACTIVE = { className: "is-active" };

/** A page's folder, made readable. "" at the root becomes a named section, otherwise the first
 *  entry would float without a label. */
function sectionLabel(section: string): string {
  return section === "" ? WIKI_TEXT.rootSection : section;
}

function groupBySection(pages: readonly WikiEntry[]): [string, WikiEntry[]][] {
  const map = new Map<string, WikiEntry[]>();
  for (const p of pages) {
    const list = map.get(p.section) ?? [];
    list.push(p);
    map.set(p.section, list);
  }
  // Root first (it is the home), then alphabetical.
  return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

export function WikiRailNav() {
  // The same key as the screen (`["wiki"]`): the index loads once and is shared, no extra request.
  const index = useQuery({ queryKey: ["wiki"], queryFn: wikiApi.index, staleTime: 60_000 });
  const params = useParams({ strict: false }) as { slug?: string };
  const pages = index.data?.pages ?? [];
  // Without a slug you are on the home: the first root page, as in the screen.
  const current = params.slug ?? pages.find((p) => p.section === "")?.slug ?? null;
  return (
    <>
      {/* The wiki had no header: its first section floated at the top of the column, and nothing
          said where you were. Same as the other two rails (nav slice 06). */}
      <RailHead
        size="lg"
        mark={
          <RailHeadMark>
            <Book size={15} />
          </RailHeadMark>
        }
        name={WIKI_TEXT.title}
      />
      {groupBySection(pages).map(([section, entries]) => (
        <Fragment key={section}>
          <NavLabel>{sectionLabel(section)}</NavLabel>
          {entries.map((e) => (
            <NavItem
              key={e.slug}
              icon={<FileText size={13} />}
              active={e.slug === current}
              render={(props) => (
                <Link to="/wiki/$slug" params={{ slug: e.slug }} activeProps={ACTIVE} {...props} />
              )}
            >
              {e.title}
            </NavItem>
          ))}
        </Fragment>
      ))}
    </>
  );
}
