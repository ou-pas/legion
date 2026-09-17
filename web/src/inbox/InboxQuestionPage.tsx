// A question has its page (07/09), route `/p/$projectId/inbox/$inboxId`.
//
// The operator's decision: a multi-field inbox form has no room in a channel column (240 to 440 px) nor
// under a thread it scrolls (two scrollbars). ONE surface asks the question, this one; all others lead
// here through a card, the way Claude's artifacts relate to their conversation.
//
// The same page freezes into a read view once answered: same URL, same component, so a pasted link
// still leads there and an interview's history is the sequence of its pages.
//
// The draft lives in the DATABASE, not the browser: decide two points on the train, finish at the
// office. It saves on each change, debounced (`use-inbox-draft.ts`), and the mention top right says so.
//
// Live updates go through the GLOBAL stream, not a page SSE: `qk.inboxQuestion` lives under the `inbox`
// prefix, already woken on `inbox_answer` and `inbox_draft` (web/src/events/control-events.ts). An
// answer from elsewhere freezes the page by itself, and a draft from another tab reloads it.
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, Link as RouterLink } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessageSquare } from "lucide-react";
import { inboxApi, INBOX_STATUS, type InboxQuestionDetail } from "../api/inbox.js";
import { type TaskLink } from "../api/tasks.js";
import { usePickedAttachments } from "../tasks/use-picked-attachments.js";
import { inboxQuestionQuery, qk, taskLinksQuery, useInvalidateLive } from "../queries.js";
import { Breadcrumb, BreadcrumbItem } from "../ui/breadcrumb.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { Link } from "../ui/link.js";
import { LOCALE } from "../ui/locale.js";
import { Page } from "../ui/page.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { Spinner } from "../ui/spinner.js";
import { Caption, Text } from "../ui/text.js";
import { humanDuration, shortDuration } from "../ui/duration.js";
import { useBackOrFallback } from "../ui/use-back-or-fallback.js";
import { useToast } from "../ui/toast.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { InboxQuestionnaire } from "./inbox-questionnaire.js";
import { InboxQuestionRead } from "./inbox-question-read.js";
import { InboxRoundContext } from "./inbox-round-context.js";
import { InboxRounds } from "./inbox-rounds.js";
import { type RoundValues } from "./inbox-round-answers.js";
import { formFieldsOf } from "./round-shape.js";
import { useInboxDraft, type DraftStatus } from "./use-inbox-draft.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-question.css";

const T = INBOX_TEXT.question;
const AT_DAY = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** The save mention, top right. Hidden until something is touched: "saved" on a freshly opened page
 *  would be false, and "not saved" needlessly alarming. */
function DraftMark({ status, now }: { status: DraftStatus; now: number }) {
  // Its place is held from the start (15/09). It appeared from nothing on save and then changed
  // length; in a wrapping row the header gained a line and the whole questionnaire moved down, twice
  // per pause. The reserved slot only keeps the page from jumping under the finger.
  return (
    <div className="inbox-q-mark" aria-live="polite">
      {status.kind === "saving" && <Caption>{T.draftSaving}</Caption>}
      {status.kind === "error" && <Caption tone="bad">{T.draftError(status.message)}</Caption>}
      {status.kind === "saved" && (
        <Caption tone="ok">{T.draftSaved(shortDuration(Math.max(0, now - status.at)))}</Caption>
      )}
    </div>
  );
}

/** The header: what locates the question, and the two exits. The thread is out of sight; the channel
 *  link and the collapsed context below compensate. */
function QuestionHead({ q, now, mark }: { q: InboxQuestionDetail; now: number; mark: ReactNode }) {
  const answered = q.answer;
  return (
    <Stack gap={10} className="inbox-q-head">
      <Row gap={10} wrap align="flex-start">
        <Stack gap={6} flex={1} minWidth={0}>
          <Heading level={2} as="h2" className="inbox-q-title">
            {q.task?.name ?? q.body}
          </Heading>
          <Row gap={8} wrap>
            {q.agent && <Tag>{q.agent.name}</Tag>}
            {answered ? (
              <StatusChip state="ok">
                {(answered.answeredBy === "system" ? T.answeredBySystem : T.answeredByYou)(
                  answered.answeredAt === null ? "" : AT_DAY.format(new Date(answered.answeredAt)),
                )}
              </StatusChip>
            ) : q.status === INBOX_STATUS.open ? (
              <StatusChip state="wait">
                {INBOX_TEXT.item.waiting(humanDuration(now - q.createdAt))}
              </StatusChip>
            ) : (
              <StatusChip state="idle">{T.closedWithoutAnswer}</StatusChip>
            )}
          </Row>
        </Stack>
        {mark}
      </Row>
      {/* The question body: the title above is the TASK's, and a round is named like
          "Round 1 — 6 questions (…)". */}
      <Text as="p" size="sm" tone="muted">
        {q.body}
      </Text>
      <InboxRoundContext evidence={q.evidence} impact={q.impact} agentName={q.agent?.name ?? "?"} />
    </Stack>
  );
}

/** The bar: where you came from, and the two exits. Navigation, needing only task and project. */
function QuestionBar({
  task,
  projectId,
  roundIndex,
}: {
  task: InboxQuestionDetail["task"];
  projectId: string;
  roundIndex: number | null;
}) {
  return (
    <Row gap={10} wrap className="inbox-q-bar">
      <Breadcrumb>
        <BreadcrumbItem
          render={(p) => <RouterLink to="/p/$projectId/inbox" params={{ projectId }} {...p} />}
        >
          {T.crumb}
        </BreadcrumbItem>
        {task && (
          <BreadcrumbItem
            render={(p) => (
              <RouterLink
                to="/p/$projectId/tasks/$taskId"
                params={{ projectId, taskId: task.id }}
                {...p}
              />
            )}
          >
            {task.name}
          </BreadcrumbItem>
        )}
        {roundIndex !== null && <BreadcrumbItem>{T.roundCrumb(roundIndex)}</BreadcrumbItem>}
      </Breadcrumb>
      <Spacer />
      {task && (
        <>
          <Link
            variant="plain"
            render={(p) => (
              <RouterLink
                to="/p/$projectId/channels/$taskId"
                params={{ projectId, taskId: task.id }}
                {...p}
              />
            )}
          >
            <MessageSquare aria-hidden="true" size={13} />
            {T.openChannel}
          </Link>
          <Link
            variant="plain"
            render={(p) => (
              <RouterLink
                to="/p/$projectId/tasks/$taskId"
                params={{ projectId, taskId: task.id }}
                {...p}
              />
            )}
          >
            {T.openTask}
            <ExternalLink aria-hidden="true" size={12} />
          </Link>
        </>
      )}
    </Row>
  );
}

/** An open question's body: the questionnaire with debounced saving behind it. A separate component
 *  because it carries TWO hooks (draft, send) the page would otherwise mount in read mode too; design
 *  rule 6 forbids a hook after a `return`, and a component is the clean way to condition hooks.
 *
 *  The form does not follow the draft state (15/09, operator feedback: it flickered on autosave). It
 *  PRODUCES the state and sends it up; the page stored it, so each autosave re-rendered the whole tree
 *  twice per pause (`saving`, `saved`). `memo` makes the path one-way. It only helps because its five
 *  props are stable, `onSent` included since `useBackOrFallback` was stabilised the same day. */
const QuestionForm = memo(function QuestionForm({
  q,
  inboxId,
  taskId,
  onSent,
  onStatus,
}: {
  q: InboxQuestionDetail;
  inboxId: string;
  taskId: string;
  onSent: () => void;
  /** Draft state GOES UP to the page, which renders the header itself and holds the order bar → header
   *  → rounds → questionnaire. Rendering the header from here put it UNDER the rounds bar (07/09). */
  onStatus: (status: DraftStatus) => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const invalidate = useInvalidateLive();
  // A screenshot attached to the round (16/09) is uploaded to the interview TASK: the reading agent is
  // the one who asked, and its grant covers that task's `/artifacts/<scope>`. Uploaded BEFORE the answer:
  // the resume prompt names the attachments present when it is built (`sessions/runner/manager.ts`), so
  // a later file would sit on disk unknown to anyone.
  const files = usePickedAttachments();
  const draft = useInboxDraft(
    useMemo(() => (formData: RoundValues) => inboxApi.saveDraft(inboxId, formData), [inboxId]),
  );
  const reply = useMutation({
    mutationFn: (formData: RoundValues) => inboxApi.replyInbox(inboxId, { formData }),
    onSuccess: () => {
      // `discard` first: `reply` cleared the draft server-side, and a late `PATCH` would bounce with a
      // pointless 409.
      draft.discard();
      push({ tone: "ok", title: T.sent });
      void qc.invalidateQueries({ queryKey: qk.inboxQuestion(inboxId) });
      invalidate(taskId);
      onSent();
    },
    onError: (err: Error) => push({ tone: "bad", title: T.sendRefused, body: err.message }),
  });
  // After render, never during: setting a parent's state mid-render trips React's guard ("Cannot
  // update a component while rendering a different component").
  useEffect(() => {
    onStatus(draft.status);
  }, [draft.status, onStatus]);
  if (!q.form) return null;
  return (
    <>
      <InboxQuestionnaire
        // Local state is authoritative while typing (08/09). Remounting on `key={draftAt}` to follow
        // a draft written elsewhere failed: OUR own write returns a new `draftAt` on each save, and
        // every selection jumped back to question 1. The server draft is read at mount (`initial`); a
        // draft from another device shows on the next page load.
        spec={q.form}
        initial={q.draft}
        pending={reply.isPending || files.busy}
        onChange={draft.schedule}
        attachments={files}
        // A failed upload STOPS the send, and `files.refusal` names the file under the chips: the round
        // stays open, the draft intact, retry.
        onSubmit={(formData) => void files.uploadThen(taskId, () => reply.mutate(formData))}
      />
    </>
  );
});

/** An answered round, read-only. The footer names the task it PRODUCED, if any, linking a decision to
 *  its outcome. */
function AnsweredRound({
  q,
  projectId,
  child,
}: {
  q: InboxQuestionDetail;
  projectId: string;
  child?: TaskLink;
}) {
  return (
    <InboxQuestionRead
      fields={formFieldsOf(q.form)}
      values={q.answer?.formData ?? {}}
      footer={
        child && (
          <Caption>
            {`${T.deposited} `}
            <Link
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/tasks/$taskId"
                  params={{ projectId, taskId: child.id }}
                  {...p}
                />
              )}
            >
              {child.name}
            </Link>
          </Caption>
        )
      }
    />
  );
}

export function InboxQuestionPage() {
  const { projectId, inboxId } = useParams({ from: "/p/$projectId/inbox/$inboxId" });
  const navigate = useNavigate();
  const [now] = useState(() => Date.now());
  // Draft state lives in the form, its MENTION in the header: the page connects them to render the
  // header in place, above the rounds.
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({ kind: "idle" });
  const { data: q, isPending } = useQuery(inboxQuestionQuery(inboxId));
  const taskId = q?.task?.id ?? "";
  const { data: links } = useQuery({ ...taskLinksQuery(taskId), enabled: taskId.length > 0 });
  /** Back to where one came from (channel, task page, inbox), falling back to the task's channel, the
   *  conversation this question is a turn of. */
  const leave = useBackOrFallback(
    () =>
      void navigate(
        taskId
          ? { to: "/p/$projectId/channels/$taskId", params: { projectId, taskId } }
          : { to: "/p/$projectId/board", params: { projectId } },
      ),
  );

  if (isPending)
    return (
      <Page>
        <Spinner size="lg" label={UI_TEXT.loading} />
      </Page>
    );
  if (!q) {
    return (
      <Page>
        <Empty
          variant="page"
          title={T.absent.title}
          action={
            <Link
              render={(p) => <RouterLink to="/p/$projectId/inbox" params={{ projectId }} {...p} />}
            >
              {T.absent.back}
            </Link>
          }
        >
          {T.absent.body}
        </Empty>
      </Page>
    );
  }

  // A ROUND is an entry of the server's `rounds` list (notices excluded). An item not in it
  // (out-of-quota pause, task wait, text question) has no page: it is answered on its card. On 07/09 an
  // out-of-quota notice opened here showed "Round 1 of 3" and an empty read view.
  const isRound = q.rounds.some((r) => r.id === q.id);
  const roundIndex = Math.max(1, q.rounds.findIndex((r) => r.id === q.id) + 1);
  const child = links?.children[0];
  const open = q.status === INBOX_STATUS.open && q.form !== null;

  const body = !isRound ? (
    // The top bar already links the channel: no second link here.
    <Empty variant="panel" title={T.notRoundTitle}>
      {T.notRound}
    </Empty>
  ) : open ? (
    <QuestionForm
      q={q}
      inboxId={inboxId}
      taskId={taskId}
      onSent={leave}
      onStatus={setDraftStatus}
    />
  ) : (
    <AnsweredRound q={q} projectId={projectId} child={child} />
  );

  return (
    <Page className="inbox-q-page">
      {/* A SHEET on the background, like every page (operator feedback, 07/09 evening). The page sets
          the frame, the sheet carries the content. */}
      <Card>
        <div className="inbox-q-sheet">
          <QuestionBar
            task={q.task}
            projectId={projectId}
            roundIndex={isRound ? roundIndex : null}
          />
          {/* The header, ONCE and HERE, before the rounds bar: its save mention describes a draft
            living in the form, sent up by `onStatus`. */}
          <QuestionHead
            q={q}
            now={now}
            mark={isRound && open ? <DraftMark status={draftStatus} now={now} /> : null}
          />

          {isRound && (
            <InboxRounds
              rounds={q.rounds}
              currentId={q.id}
              render={(round, props) => (
                <RouterLink
                  to="/p/$projectId/inbox/$inboxId"
                  params={{ projectId, inboxId: round.id }}
                  {...props}
                />
              )}
            />
          )}

          {/* OPEN → the questionnaire, full width. ANSWERED (or closed unanswered) → the read view. The
            switch follows `status`, not local state, so an answer from elsewhere triggers it through
            cache invalidation alone. */}
          {body}
        </div>
      </Card>
    </Page>
  );
}
