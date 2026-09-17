// The concierge page (nav project, concierge batch: three screens merged into one, 12/09).
//
// "It's not showing you data. It's giving you decisions." A hover panel that forgot everything on
// reload could get away with being empty; an empty page is a broken promise. So the situation
// report is the first turn of the conversation, not a banner above it (decision of 29/08,
// `produit/decisions`): the page has no empty state, and history has a place to live.
//
// The conversation list sits in a pane next to the thread, same geometry as Channels
// (`channels/ChannelsPage.tsx`). Opening a conversation navigates to `/concierge/$conversationId`,
// a sibling of `/concierge`, not local state, like an open channel (`/channels/$taskId`) or a wiki
// page (`/wiki/$slug`). The old addresses (`/concierge/conversations`, `/concierge/conversations/$id`)
// redirect here (`web/src/router.tsx`) for bookmarks and pasted links.
//
// No `refetchInterval` in this file, and that is the point: every situation report is a model call.
// You ask for it or you do not have it. Its age is shown, and "refresh" is the only gesture that
// spends. See the header of `server/src/concierge/concierge-brief.ts`.
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { conciergeApi, type ConciergeTurn } from "../api/concierge.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Chip } from "../ui/chip.js";
import { Link as UiLink } from "../ui/link.js";
import { Page } from "../ui/page.js";
import { Select } from "../ui/select.js";
import { Spinner } from "../ui/spinner.js";
import { useToast } from "../ui/toast.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { ConciergeBrief } from "./concierge-brief.js";
import { ConciergePanel } from "./concierge-panel.js";
import { ConversationList } from "./conversation-list.js";
import { CONCIERGE_TEXT } from "./text.js";
import "./concierge-page.css";

/** Generous `staleTime` and no `refetchOnWindowFocus`: coming back to the tab must not ask for a
 *  new report. The server would serve it from its cache within its window, so it would not cost a
 *  model call, but relying on that would put the on-demand rule in someone else's hands. */
const briefQuery = queryOptions({
  queryKey: qk.conciergeBrief,
  queryFn: () => conciergeApi.brief(),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});

const conversationsQuery = queryOptions({
  queryKey: qk.conciergeConversations,
  queryFn: () => conciergeApi.conversations(),
});

const conversationQuery = (id: string | null) =>
  queryOptions({
    queryKey: qk.conciergeConversation(id ?? "none"),
    queryFn: () => conciergeApi.conversation(id!),
    enabled: id !== null,
  });

/** The situation report at the head of the thread, the conversations listed beside it. */
// oxlint-disable-next-line complexity -- four requests with defaults, and the "resume, reopen a past conversation or start over" choice running through the thread's props
export function ConciergePage() {
  // `strict: false`: the page has two sibling routes, like Channels: `/concierge` and
  // `/concierge/$conversationId`. The open conversation lives in the URL, not in local state:
  // otherwise no link could lead to a given conversation, and a reload always reopened the last.
  const { conversationId: routeId } = useParams({ strict: false }) as {
    conversationId?: string;
  };
  const navigate = useNavigate();
  const brief = useQuery(briefQuery);
  const conversations = useQuery(conversationsQuery);
  const latest = conversations.data?.latest ?? null;
  const qc = useQueryClient();
  const { push } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  // Resume or start over. By default the page resumes the last conversation, because that is where
  // you come back to: a new one on every visit would turn the list into a graveyard of one-question
  // threads. But resuming without a way to start over locks you in one ever-growing thread. Local
  // state is enough: the thread adopts the id the server returns on the first send.
  const [fresh, setFresh] = useState(false);

  // The open conversation: the URL's if present, else the most recent. Selecting a row navigates
  // (below), so the URL always has the last word.
  const selectedId = fresh ? null : (routeId ?? latest);
  const thread = useQuery(conversationQuery(selectedId));

  const refresh = () => {
    setRefreshing(true);
    conciergeApi
      .brief(true)
      .then((b) => qc.setQueryData(qk.conciergeBrief, b))
      // Never swallowed: an invisible refusal reads as "nothing changed".
      .catch((e: Error) =>
        push({ tone: "bad", title: CONCIERGE_TEXT.brief.failed, body: e.message }),
      )
      .finally(() => setRefreshing(false));
  };

  /** Picking a conversation from the list navigates: the URL carries the state, it does not follow
   *  it (same pattern as `channels/ChannelsPage.tsx`). */
  const openConversation = (id: string) => {
    setFresh(false);
    void navigate({ to: "/concierge/$conversationId", params: { conversationId: id } });
  };

  /** Starting over also leaves a specific conversation's address: otherwise the URL would still
   *  name the old thread while the screen shows an empty one. */
  const goFresh = () => {
    setFresh(true);
    if (routeId !== undefined) void navigate({ to: "/concierge", replace: true });
  };

  // All hooks are done: early returns are safe from here (rule 6).
  const loading =
    brief.isPending || conversations.isPending || (selectedId !== null && thread.isPending);
  if (loading) {
    return (
      <Page
        title={CONCIERGE_TEXT.page.title}
        sub={CONCIERGE_TEXT.page.sub}
        className="cc-page"
        actions={<Chip size="sm">{CONCIERGE_TEXT.page.readOnly}</Chip>}
      >
        <Spinner size="lg" label={UI_TEXT.loading} />
      </Page>
    );
  }

  const lead = brief.data && (
    <ConciergeBrief
      brief={brief.data}
      refreshing={refreshing}
      onRefresh={refresh}
      renderTaskLink={(taskId, projectId, label) =>
        projectId ? (
          <UiLink
            render={(p) => (
              <Link to="/p/$projectId/tasks/$taskId" params={{ projectId, taskId }} {...p} />
            )}
          >
            {label}
          </UiLink>
        ) : (
          <>{label}</>
        )
      }
      // The very first launch: `/` is the preflight while no project exists, so the first one is
      // created there; the page does not reinvent a form for it.
      action={
        <UiLink render={(p) => <Link to="/" {...p} />}>{CONCIERGE_TEXT.brief.first.action}</UiLink>
      }
    />
  );
  // The lead goes with the most recent conversation, whether reached by default or reopened from
  // the list; never with an older one, which reads alone.
  const showLead = fresh || selectedId === latest;

  // An id naming nothing gets a 404 from the server: show its sentence rather than an empty thread,
  // which would suggest a lost conversation.
  const missing = routeId !== undefined && thread.isError;

  // The gesture only shows when there is something to leave. On an already fresh conversation it
  // would do nothing, and a button that does nothing teaches people to stop reading buttons.
  const startFresh =
    selectedId !== null && !fresh ? (
      <Button variant="ghost" size="sm" onClick={goFresh}>
        {CONCIERGE_TEXT.page.fresh}
      </Button>
    ) : null;

  return (
    <Page
      title={CONCIERGE_TEXT.page.title}
      sub={CONCIERGE_TEXT.page.sub}
      className="cc-page"
      actions={
        <>
          {startFresh}
          <Chip size="sm">{CONCIERGE_TEXT.page.readOnly}</Chip>
        </>
      }
    >
      {/* Below 640px this selector replaces the list, same pattern as `.ch-switch`
          (channels/ChannelsPage.tsx): never visible with the list, CSS decides, no React state. */}
      {conversations.data && conversations.data.conversations.length > 0 && (
        <div className="cc-switch">
          <Select
            aria-label={CONCIERGE_TEXT.conversations.title}
            value={selectedId ?? ""}
            onChange={(e) => openConversation(e.target.value)}
          >
            {conversations.data.conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || CONCIERGE_TEXT.conversations.untitled}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="cc-body">
        <aside className="cc-aside">
          <ConversationList
            conversations={conversations.data?.conversations ?? []}
            selectedId={selectedId}
            onOpen={openConversation}
          />
        </aside>
        <div className="cc-main">
          {missing ? (
            <p className="cc-page-missing">{thread.error?.message}</p>
          ) : (
            <ConciergeThread
              key={fresh ? "neuve" : (selectedId ?? "neuve")}
              conversationId={fresh ? null : selectedId}
              initialTurns={fresh ? [] : (thread.data?.turns ?? [])}
              lead={showLead ? lead : undefined}
            />
          )}
        </div>
      </div>
    </Page>
  );
}

/** The thread, and the only place talking to the server. `key` on the id: switching conversation
 *  remounts the panel instead of syncing its state; an effect copying turns would overwrite what
 *  was just typed. */
function ConciergeThread({
  conversationId,
  initialTurns,
  lead,
}: {
  conversationId: string | null;
  initialTurns: ConciergeTurn[];
  lead?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(conversationId);

  const ask = (message: string): Promise<string> =>
    conciergeApi.ask(message, current).then((r) => {
      setCurrent(r.conversationId);
      // The list just changed (one more turn, one more conversation): refetch it rather than
      // recompute it here, where neither order nor titles are known.
      void qc.invalidateQueries({ queryKey: qk.conciergeConversations });
      return r.reply;
    });

  return (
    <ConciergePanel
      key={conversationId ?? "neuve"}
      onAsk={ask}
      initialTurns={initialTurns}
      lead={lead}
      size="fill"
      className="cc-page-thread"
    />
  );
}
