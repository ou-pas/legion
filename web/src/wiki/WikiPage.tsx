// The wiki screen: the page being read, and its backlinks below. The table of contents lives in
// the application rail (`wiki/wiki-rail.tsx`).
//
// Backlinks sit at the bottom rather than in the margin because they are read after the page, not
// during.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "@tanstack/react-router";
import { BookOpen, CornerUpLeft } from "lucide-react";
import { wikiApi, type WikiEntry } from "../api/wiki.js";
import { sectionsOf, WIKI_TOP_ID } from "./blocks.js";
import { WikiSheet } from "./wiki-anchors.js";
import { WikiMarkdown } from "./wiki-markdown.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { ErrorState } from "../ui/error-state.js";
import { Page } from "../ui/page.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Caption } from "../ui/text.js";
import { WIKI_TEXT } from "./text.js";
import "./wiki.css";

function Backlinks({ pages }: { pages: readonly WikiEntry[] }) {
  if (pages.length === 0) return null;
  return (
    <Card icon={<CornerUpLeft size={15} />} title={WIKI_TEXT.backlinks}>
      <Stack gap={4}>
        {pages.map((p) => (
          <RouterLink
            key={p.slug}
            to="/wiki/$slug"
            params={{ slug: p.slug }}
            className="dm-wiki-link"
          >
            {p.title}
          </RouterLink>
        ))}
      </Stack>
    </Card>
  );
}

// oxlint-disable-next-line complexity -- four wiki states (loading, index failed, empty wiki, page) and one `?? default` per value not read yet
export function WikiScreen() {
  const params = useParams({ strict: false }) as { slug?: string };
  const index = useQuery({ queryKey: ["wiki"], queryFn: wikiApi.index, staleTime: 60_000 });
  const pages = index.data?.pages ?? [];
  // Without a slug, open the first root page: in a wiki, the home is a page.
  const slug = params.slug ?? pages.find((p) => p.section === "")?.slug ?? null;
  const page = useQuery({
    queryKey: ["wiki-page", slug],
    queryFn: () => wikiApi.page(slug!),
    enabled: slug !== null,
    staleTime: 60_000,
  });
  // Before any early return: a hook after an `if` crashes the app in production with no type error
  // (rule 6 of the design contract).
  const content = page.data?.content ?? "";
  // The top of the page is an entry like the others (30/08). Text before the first heading belonged
  // to no section, so nothing brought you back up once scrolled. The section list now starts with
  // the page itself, which also gives a shareable link to its start.
  const title = page.data?.title ?? "";
  const sections = useMemo(
    // `index: -1`: the top precedes the first rendered block. The renderer finds an id by this
    // position, and no block carries this one.
    () => [{ index: -1, id: WIKI_TOP_ID, title }, ...sectionsOf(content)],
    [content, title],
  );

  if (index.isLoading)
    return (
      <Page title={WIKI_TEXT.title}>
        <Card>
          <SkeletonText lines={5} label={WIKI_TEXT.loading} />
        </Card>
      </Page>
    );

  if (index.isError)
    return (
      <Page title={WIKI_TEXT.title}>
        <ErrorState title={WIKI_TEXT.indexFailed}>
          {String((index.error as Error).message)}
        </ErrorState>
      </Page>
    );

  if (pages.length === 0)
    return (
      <Page title={WIKI_TEXT.title}>
        <Empty variant="page" title={WIKI_TEXT.emptyTitle}>
          {WIKI_TEXT.emptyBody}
        </Empty>
      </Page>
    );

  return (
    <Page className="dm-wiki-page" title={WIKI_TEXT.title} sub={WIKI_TEXT.sub}>
      {page.isError ? (
        <ErrorState title={WIKI_TEXT.pageFailed}>
          {String((page.error as Error).message)}
        </ErrorState>
      ) : page.data ? (
        // The width the reading measure left unused carries the open page's sections (nav slice
        // 07); the rail carries the page list.
        <WikiSheet sections={sections}>
          {/* The page is the card's content: its title becomes the card header.

                  The card does not move, its inside scrolls: the frame holds the height and the
                  header stays readable while reading. The first version scrolled the whole card,
                  so its bottom edge rose mid-screen and left a large gap below. */}
          <Card className="dm-wiki-card" icon={<BookOpen size={16} />} title={page.data.title}>
            <div className="dm-wiki-scroll">
              {/* The "top of page" target: the first node of the scrolling area, so `#…` returns
                      exactly to the start, intro included. A bare `div` rather than an `id` prop
                      on `Stack`: the shared shell need not grow a prop for one screen. */}
              <div id={WIKI_TOP_ID}></div>
              <Stack gap={10}>
                {page.data.truncated && <Caption>{WIKI_TEXT.truncated}</Caption>}
                <WikiMarkdown content={page.data.content} links={page.data.links} />
                {/* Inside the scrolling area, not under the card: backlinks are the end of the
                        page, not an object next to it. */}
                <Backlinks pages={page.data.backlinks} />
              </Stack>
            </div>
          </Card>
        </WikiSheet>
      ) : (
        <Card>
          <SkeletonText lines={8} label={WIKI_TEXT.loading} />
        </Card>
      )}
    </Page>
  );
}
