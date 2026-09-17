// A task's nine views, one per route (slice nav/17; ten until 05/09, when "Diff" joined "PR").
//
// They were nine `<TabPanel>`s in `TaskPage.tsx`, plus two panels living in the stack above them
// (criteria and lineage). A tab is not an address: no link to a task's diff, no coming back with
// "back". The rail lists them now (`projects/rail-sections.ts`), and this module is only a catalogue
// of screens, as `ProjectPage.tsx` is for the Settings sections.
//
// Only one screen is mounted because only one is there. The price, written in the slice: a left
// view's local state does not come back.
//
// Rail ranks are STATIC, so a view WITHOUT CONTENT SAYS SO: more readable than a rank that vanishes.
import { Fragment, useState } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlignLeft,
  ClipboardCheck,
  FileText,
  GitPullRequest,
  MessagesSquare,
  Package,
  Pencil,
  StickyNote,
  Timer,
} from "lucide-react";
import { parseJsonOr } from "../api/json.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { artifactsQuery, attachmentsQuery, taskLinksQuery } from "../queries.js";
import { OPERATOR } from "../channels/channel.js";
import { InterviewTab } from "../interviews/interview-tab.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { DiffView } from "../review/diff-view.js";
import { PrActions } from "../review/pr-actions.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Divider } from "../ui/divider.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { Textarea } from "../ui/input.js";
import { Link } from "../ui/link.js";
import { Markdownish } from "../ui/markdownish.js";
import { Prose } from "../ui/prose.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Caption, Label, Text } from "../ui/text.js";
import { Timeline, TimelineItem } from "../ui/timeline.js";
import { useToast } from "../ui/toast.js";
import { ArtifactChip, ArtifactPreview } from "./artifact-chip.js";
import { BriefAttachments } from "./brief-attachments.js";
import { useBriefAttachments } from "./use-brief-attachments.js";
import { parseCriteria } from "./criteria.js";
import { PrTab } from "./pr-tab.js";
import { TaskCriteriaPanel } from "./task-criteria.js";
import { TaskLinksPanel } from "./task-links.js";
import { TaskNotes } from "./task-notes.js";
import { useTaskShell } from "./TaskPage.js";
import { rows } from "./timeline-rows.js";
import { prUrlsOf } from "./pr-state.js";
import { pushedRepos } from "./session-facts.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";
import { TASK_LINKS_TEXT } from "./text/task-links.js";
import { TASK_RUN_TEXT } from "./text/task-run.js";

/** The interview (D9ter): the SAME thread as the task channel, same segments, same component. First
 *  rank of the rail, because on an interview task it IS the content. */
export function InterviewScreen() {
  const { task, agent, segments, interview } = useTaskShell();
  return (
    <Card icon={<MessagesSquare size={16} />} title={INTERVIEW_TEXT.tab.label}>
      {interview ? (
        <InterviewTab
          brief={task.description}
          briefAuthor={OPERATOR}
          briefAt={Date.parse(task.createdAt)}
          segments={segments}
          agentName={agent?.name ?? OPERATOR}
          channelLink={
            <Link
              render={(p) => (
                <RouterLink
                  to="/p/$projectId/channels/$taskId"
                  params={{ projectId: task.projectId, taskId: task.id }}
                  {...p}
                />
              )}
            >
              {INTERVIEW_TEXT.compare.link}
            </Link>
          }
        />
      ) : (
        <Empty variant="panel" title={T.empty.interviewTitle}>
          {T.empty.interviewWhy}
        </Empty>
      )}
    </Card>
  );
}

/** The report: the agent's last message, read as a document. The default view once the session is
 *  over: the page first answers "what happened?", the raw trace stays one click away. */
export function ReportScreen() {
  const { report } = useTaskShell();
  return (
    <Card
      icon={<AlignLeft size={16} />}
      title={T.views.report}
      actions={report.available ? <Caption tone="muted">{T.report.hint}</Caption> : undefined}
    >
      {/* Markdownish, not Paragraphs: the agent writes Markdown (bold, lists, `code`), and plain text
          read as asterisks. */}
      {report.available ? (
        <Markdownish text={report.text} />
      ) : (
        <Empty variant="panel" title={T.empty.reportTitle}>
          {T.empty.reportWhy}
        </Empty>
      )}
    </Card>
  );
}

/** The trace: the raw stream, and nothing else since the report is read separately. The only view
 *  taking the full height (`tsk-fill`): its pane used to cap at 480px, adding a second scrollbar
 *  inside an already scrolling view. */
export function TimelineScreen() {
  const { task, session, active, events, stream, reconnect } = useTaskShell();
  return (
    <div className="tsk-fill">
      <Card icon={<Timer size={16} />} title={T.views.timeline}>
        <Stack gap={10} className="tsk-fill-body">
          {/* Only while a session RUNS: at the end the server closes the stream normally, and
              announcing a cut there would be a false positive. */}
          {active && stream !== "live" && (
            <Banner
              tone="wait"
              title={
                stream === "retry"
                  ? TASK_RUN_TEXT.stream.interruptedRetry
                  : TASK_RUN_TEXT.stream.interrupted
              }
              actions={
                stream === "closed" ? (
                  <Button size="sm" onClick={reconnect}>
                    {TASK_RUN_TEXT.stream.reconnect}
                  </Button>
                ) : undefined
              }
            >
              {stream === "retry" ? TASK_RUN_TEXT.stream.retryWhy : TASK_RUN_TEXT.stream.closedWhy}
            </Banner>
          )}
          {events.length === 0 ? (
            <Empty
              variant="panel"
              title={session ? TASK_RUN_TEXT.trace.empty : TASK_RUN_TEXT.trace.neverRun}
            >
              {session ? TASK_RUN_TEXT.trace.emptyWhy : TASK_RUN_TEXT.trace.neverRunWhy}
            </Empty>
          ) : (
            <ScrollArea
              size="fill"
              label={TASK_RUN_TEXT.trace.scrollLabel}
              // Positioned at the bottom on arrival, then follows while you stay there. Scroll up
              // and it lets go: a pill says what arrived meanwhile. The previous `scrollIntoView`
              // scrolled the whole PAGE on every event, unasked.
              follow
              count={events.length}
              liveNoun={TASK_RUN_TEXT.trace.liveNoun}
            >
              <Timeline live label={TASK_RUN_TEXT.trace.label(task.name)}>
                {rows(events).map((r) => (
                  <TimelineItem
                    key={r.key}
                    time={r.time}
                    dateTime={r.dateTime}
                    kind={r.kind}
                    emphasis={r.emphasis}
                    summary={r.summary}
                  >
                    {r.detail}
                  </TimelineItem>
                ))}
              </Timeline>
            </ScrollArea>
          )}
        </Stack>
      </Card>
    </div>
  );
}

/** Notes, across all sessions. A view apart from the trace: a note is a sentence the agent wrote, the
 *  trace is an event log. */
export function NotesScreen() {
  const { task } = useTaskShell();
  // Fetched here rather than passed down from the shell: same cache key, so the cache answers without
  // a request, and the shell no longer carries data it does not show.
  const { data: notes = [] } = useQuery({
    queryKey: ["task-notes", task.id] as const,
    queryFn: () => tasksApi.activity(task.id),
    staleTime: 10_000,
  });
  return (
    <Card
      icon={<StickyNote size={16} />}
      title={T.views.notes}
      actions={<Caption tone="muted">{T.notes.hint}</Caption>}
    >
      <TaskNotes notes={notes} />
    </Card>
  );
}

/** The brief, and with it the LINEAGE: what was asked of this task, where it comes from and what it
 *  proposed read together. The unmet prerequisite lineage flags is also carried by the head's
 *  two-step "approve" button, so the decision does not depend on having opened a view. */
export function BriefScreen() {
  const { task, active, refresh } = useTaskShell();
  const { push } = useToast();
  const { data: links } = useQuery(taskLinksQuery(task.id));
  /** The child whose assignment is in flight. An id, not a boolean: two children commit one after
   *  the other without the first button greying the second. */
  const [adopting, setAdopting] = useState<string | null>(null);
  return (
    <Stack gap={12}>
      <Card icon={<FileText size={16} />} title={T.views.brief}>
        <Brief task={task} active={active} onSaved={refresh} />
      </Card>
      {links && (
        <TaskLinksPanel
          links={links}
          projectId={task.projectId}
          busyId={adopting}
          onAdopt={(childId, agentId) => {
            setAdopting(childId);
            // `adoptChild` assigns THEN moves to todo, two PATCHes in that order: todo is the queue,
            // and a task queued without an agent is never picked up.
            tasksApi
              .adoptChild(childId, agentId)
              .then(refresh)
              .catch((e: Error) =>
                push({ tone: "bad", title: TASK_LINKS_TEXT.adoptRefused, body: e.message }),
              )
              .finally(() => setAdopting(null));
          }}
        />
      )}
    </Stack>
  );
}

/** What the task must prove. It was a permanent panel of the stack; it is the contract written in
 *  advance, so it belongs to the "Contract" group with the brief. */
export function CriteriaScreen() {
  const { task } = useTaskShell();
  // The panel renders nothing when the column is empty or unreadable, right inside a stack, but an
  // empty view must explain itself.
  if (parseCriteria(task.criteria)) return <TaskCriteriaPanel criteria={task.criteria} />;
  return (
    <Card icon={<ClipboardCheck size={16} />} title={T.views.criteria}>
      <Empty variant="panel" title={T.empty.criteriaTitle}>
        {T.empty.criteriaWhy}
      </Empty>
    </Card>
  );
}

/** The PR, read like a GitHub page (05/09, mock-up `direction-pr-diff.html`, variant A): the short
 *  `pr.md` draft first, then the long diff and its pre-review. They used to be two views: the draft
 *  was read without seeing what it published, and the PR created from a view without the diff.
 *
 *  The draft is only READ here, and that is the point: it must not load until asked for. With
 *  nothing pushed there is neither draft nor diff, and a single empty state says so. */
export function PrScreen() {
  const { task, hasPr, events, refresh } = useTaskShell();
  const prUrls = prUrlsOf(task);
  return (
    <Card
      icon={<GitPullRequest size={16} />}
      title={T.views.pr}
      /* Gestures in the title bar (15/09). They were scattered in the body (open button under the
         draft, repairs at the very top), and this card's body is long (draft then diff), so a
         gesture scrolled out of view while reading. */
      actions={
        hasPr ? (
          <PrActions
            taskId={task.id}
            prUrls={prUrls}
            pushedCode={pushedRepos(events).length > 0}
            onCreated={refresh}
          />
        ) : undefined
      }
    >
      {hasPr ? (
        <Stack gap={12}>
          <PrTab task={task} prUrls={prUrls} />
          <Divider />
          <DiffView taskId={task.id} />
        </Stack>
      ) : (
        <Empty variant="panel" title={T.empty.prTitle}>
          {T.empty.prWhy}
        </Empty>
      )}
    </Card>
  );
}

/** Artifacts dropped in `/artifacts`, and those the step expected. */
export function ArtifactsScreen() {
  const { task } = useTaskShell();
  return (
    <Card icon={<Package size={16} />} title={T.views.artifacts}>
      <Artifacts task={task} />
    </Card>
  );
}

/** Plain text read as a document: paragraphs on blank lines, single line breaks kept. */
function Paragraphs({ text }: { text: string }) {
  return (
    <Prose size="sm">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {para.split("\n").map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </Prose>
  );
}

// The brief: the instruction actually sent to the agent (`task.description`, read by
// `server/src/sessions/runner/brief.ts`, `buildTaskBrief`). This card used to show only the FIRST
// LINE of the description with no way to write it: a task created from the board left with an empty
// brief, and the screen did not say so.
function Brief({ task, active, onSaved }: { task: Task; active: boolean; onSaved: () => void }) {
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description);
  const [saving, setSaving] = useState(false);

  const save = () => {
    // Double-submit guard (D5): button and ⌘/Ctrl+Enter trigger the same `save`, and without it two
    // ⌘+Enter in a row would send two PATCHes.
    if (saving) return;
    setSaving(true);
    tasksApi
      .setTaskDescription(task.id, draft)
      .then(() => {
        setEditing(false);
        onSaved();
      })
      .catch((e: Error) => push({ tone: "bad", title: T.brief.notSaved, body: e.message }))
      .finally(() => setSaving(false));
  };

  if (editing) {
    return (
      <Stack gap={8}>
        <Field label={T.brief.fieldLabel}>
          <Textarea
            rows={12}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitKey(e)) save();
            }}
          />
        </Field>
        <Row gap={6}>
          <Button variant="primary" loading={saving} onClick={save} shortcut={<SubmitShortcut />}>
            {T.brief.save}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(task.description);
              setEditing(false);
            }}
          >
            {T.brief.cancel}
          </Button>
        </Row>
      </Stack>
    );
  }

  // While a session works the brief is gone: the server refuses to rewrite it (409). So no button,
  // but the reason, which a greyed-out button does not give.
  return (
    <Stack gap={6}>
      <Row gap={6}>
        {!active ? (
          <Button
            size="sm"
            variant="quiet"
            leading={<Pencil size={12} />}
            onClick={() => {
              setDraft(task.description);
              setEditing(true);
            }}
          >
            {task.description.trim() ? T.brief.edit : T.brief.write}
          </Button>
        ) : (
          <Caption tone="muted">{T.brief.locked}</Caption>
        )}
      </Row>
      {task.description.trim() ? (
        <Paragraphs text={task.description} />
      ) : (
        <Text as="p" size="sm" tone="muted">
          {T.brief.empty}
        </Text>
      )}
      {/* Attachments UNDER the brief, in the same view: they are part of it, the agent receives them
          with it. */}
      <BriefAttachmentsPanel task={task} />
    </Stack>
  );
}

/** The Brief view's attachments panel: network wiring on one side, display on the other. It only
 *  exists to keep the hook out of `Brief`, which is in edit mode half the time: a hook cannot sit
 *  behind an `if`. */
function BriefAttachmentsPanel({ task }: { task: Task }) {
  const wiring = useBriefAttachments(task);
  return <BriefAttachments {...wiring} />;
}

function Artifacts({ task }: { task: Task }) {
  const { data: artifacts = [] } = useQuery(artifactsQuery(task.id));
  // The OPERATOR's files, listed apart (`attachments/`): the view must say WHO dropped what. Mixing a
  // capture attached to the request with a produced artifact skews the review, and an expected
  // artifact cannot be satisfied by a file one dropped oneself.
  const { data: attachments = [] } = useQuery(attachmentsQuery(task.id));
  // Read tolerantly: an unreadable list in the database means "nothing expected", not a blank page
  // (`api/json.ts`).
  const expected = parseJsonOr<string[]>(task.expectedArtifacts, []);
  // Review flow: land on the view with the first expected (or first) artifact already open.
  const defaultOpen =
    expected.find((n) => artifacts.some((a) => a.name === n)) ?? artifacts[0]?.name ?? null;
  const [openName, setOpenName] = useState<string | null | undefined>(undefined); // undefined = not chosen yet
  const effectiveOpen = openName === undefined ? defaultOpen : openName;

  return (
    <Stack gap={12}>
      {expected.length > 0 && (
        <Stack gap={6}>
          <Label>{T.artifacts.expected}</Label>
          <Row gap={8} wrap>
            {expected.map((n) => (
              <ArtifactChip key={n} name={n} present={artifacts.some((a) => a.name === n)} />
            ))}
          </Row>
        </Stack>
      )}
      {/* Read-only HERE: attaching happens from the brief, where the request is written. Two places
          for the same gesture would be two states to keep in agreement. The component removes
          itself when there is nothing to show. */}
      <BriefAttachments
        label={T.attachments.fromOperator}
        attachments={attachments}
        urlOf={(name) => tasksApi.attachmentUrl(task.id, name)}
      />

      {artifacts.length === 0 ? (
        <Empty variant="panel" title={T.artifacts.emptyTitle}>
          {T.artifacts.emptyBefore(Boolean(task.assigneeAgentId))}
          <Code variant="bare">/artifacts</Code>
          {T.artifacts.emptyAfter}
        </Empty>
      ) : (
        <Stack gap={6}>
          {/* The heading only shows when there is something to confuse: without attachments the
              artifact list IS the only one, and titling it would be noise. */}
          {attachments.length > 0 && <Label>{T.attachments.fromAgent}</Label>}
          <Row gap={8} wrap>
            {artifacts.map((a) => (
              <ArtifactChip
                key={a.name}
                name={a.name}
                sizeBytes={a.size}
                kind={a.kind}
                selected={effectiveOpen === a.name}
                onSelect={() => setOpenName(effectiveOpen === a.name ? null : a.name)}
              />
            ))}
          </Row>
        </Stack>
      )}
      {effectiveOpen && (
        <ArtifactPreview
          name={effectiveOpen}
          src={tasksApi.artifactUrl(task.id, effectiveOpen)}
          kind={artifacts.find((a) => a.name === effectiveOpen)?.kind}
          onClose={() => setOpenName(null)}
        />
      )}
    </Stack>
  );
}
