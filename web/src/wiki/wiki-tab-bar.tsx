// The phone bar on the wiki: the same pages as the rail, laid flat, after the exit to projects.
//
// Folder headings do not survive going horizontal, on purpose: a heading marks a column and means
// nothing between two targets of a row. The order is kept (root first, then folders), so pages of
// one folder stay neighbours.
//
// The open page scrolls itself into view (`TabBar`), which is the only thing that makes a list of
// twenty-five pages usable by finger.
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { wikiApi } from "../api/wiki.js";
import { HOME_TAB, TabBar } from "../app/tab-bar.js";

const ACTIVE = { className: "is-active" };

export function WikiTabBar() {
  // The same key as the screen and the rail (`["wiki"]`): the index loads once and is shared.
  const index = useQuery({ queryKey: ["wiki"], queryFn: wikiApi.index, staleTime: 60_000 });
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const pages = index.data?.pages ?? [];
  return (
    <TabBar
      here={slug ?? "/wiki"}
      rows={[
        HOME_TAB,
        ...pages.map((p) => ({ to: `/wiki/${p.slug}`, label: p.title, Icon: FileText })),
      ]}
      // `to` is built, not literal: wiki pages are data, not declared routes. The `/wiki/$slug`
      // route serves them all, and `Link` takes it with its parameter; an assembled path would
      // lose the match.
      render={(to, props) =>
        to === HOME_TAB.to ? (
          <Link to={to} activeProps={ACTIVE} {...props} />
        ) : (
          <Link
            to="/wiki/$slug"
            params={{ slug: to.slice("/wiki/".length) }}
            activeProps={ACTIVE}
            {...props}
          />
        )
      }
    />
  );
}
