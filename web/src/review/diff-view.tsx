// A task's pre-review, the orchestrator: loads the branch diff and comments, opens an editor under
// the selected line (or RANGE), and carries the ONLY send gesture, which relaunches a session on
// the same branch with the whole review. Sending costs a session, hence a two-step ConfirmAction,
// like the kill switch.
//
// Selection (v33, operator feedback 24/08): a click sets the anchor, SHIFT-click extends the range
// on the SAME diff side. Enter makes a new line, ⌘/Ctrl+Enter sends, Escape cancels.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send } from "lucide-react";
import { parseDiff, type ChangeData, type HunkData } from "react-diff-view";
import { reviewApi, type RepoDiff, type ReviewComment } from "../api/review.js";
import { qk } from "../queries.js";
import { Button, IconBtn } from "../ui/button.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Empty } from "../ui/empty.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { Textarea } from "../ui/input.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Caption, Text } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { SplitPane } from "../ui/split.js";
import { DiffFile } from "./diff-file.js";
import { DiffTree } from "./diff-tree.js";
import { buildFileTree, fileAnchorId } from "./file-tree.js";
import { changeAnchor, spanOf, type Selection } from "./diff-anchor.js";
import { REVIEW_TEXT } from "./text.js";
import { REVIEW_COMMENT_STATUS } from "../api/review.js";

/** GitHub's compare API only returns the `patch` (hunks), and `parseDiff` expects a full diff: the
 *  minimal header is rebuilt, which avoids keeping a home-made parser next to its own. */
function hunksOf(path: string, patch: string | null): HunkData[] | null {
  if (patch === null) return null;
  try {
    const files = parseDiff(
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`,
    );
    return files[0]?.hunks ?? [];
  } catch {
    return null; // unreadable patch: same "unavailable" state as a binary, never a blank screen
  }
}

/** One row per pushed file across repositories, with what concerns it: what the tree shows. */
function fileRows(repos: RepoDiff[], comments: ReviewComment[]) {
  return repos.flatMap((r) =>
    (r.files ?? []).map((f) => ({
      repo: r.repo,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      comments: comments.filter((c) => c.repoName === r.repo && c.filePath === f.path).length,
    })),
  );
}

/** Every folder path of the tree, to open them on first render. */
function allDirs(nodes: ReturnType<typeof buildFileTree>): string[] {
  return nodes.flatMap((n) => (n.kind === "dir" ? [n.path, ...allDirs(n.children)] : []));
}

/** A comment editor, rendered under the line (or range) it targets. It knows nothing of the diff:
 *  it gets the range to announce, the draft, and the three gestures. */
function CommentEditor({
  span,
  path,
  draft,
  error,
  busy,
  onDraft,
  onSave,
  onCancel,
}: {
  span: { start: number; end: number } | null;
  path: string;
  draft: string;
  error: string;
  busy: boolean;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Stack gap={6} className="dm-diff-editor">
      {span && span.start !== span.end && (
        <Caption>{REVIEW_TEXT.diff.rangeCaption(span.start, span.end)}</Caption>
      )}
      <Textarea
        rows={3}
        autoFocus
        value={draft}
        placeholder={REVIEW_TEXT.diff.commentPlaceholder}
        aria-label={REVIEW_TEXT.diff.commentLabel(path, String(span?.end ?? ""))}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter = new line (review comments are often multi-line); ⌘/Ctrl+Enter sends, as
          // everywhere else (ui/submit-key.ts).
          if (isSubmitKey(e)) {
            e.preventDefault();
            onSave();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <Row gap={6} wrap>
        <Button
          size="md"
          variant="primary"
          disabled={!draft.trim() || busy}
          onClick={onSave}
          shortcut={<SubmitShortcut />}
        >
          {REVIEW_TEXT.diff.comment}
        </Button>
        <Button size="md" variant="quiet" onClick={onCancel}>
          {REVIEW_TEXT.diff.cancel}
        </Button>
        <Caption>{REVIEW_TEXT.diff.extendHint}</Caption>
      </Row>
      {error && <FormError>{error}</FormError>}
    </Stack>
  );
}

// oxlint-disable-next-line complexity -- the diff's four states read in one column (loading, failure, repo in error, nothing pushed), the rest is a `?? default` per missing datum
export function DiffView({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Collapsed by default (24/08): `openFiles` holds the EXCEPTIONS; on a 48-file diff the default
  // must be silence.
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [openDirs, setOpenDirs] = useState<Set<string> | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  const diff = useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => reviewApi.taskDiff(taskId),
    staleTime: 30_000,
  });
  const commentsQ = useQuery({
    queryKey: ["review-comments", taskId],
    queryFn: () => reviewApi.reviewComments(taskId),
  });
  const comments = commentsQ.data ?? [];
  const open = comments.filter((c) => c.status === REVIEW_COMMENT_STATUS.open);
  // Returned, not `void`ed (16/09): sending the review and deleting a comment spin until the list is
  // up to date, not just until the HTTP response (D2, spec 2jan8IZn61).
  const refreshComments = () => qc.invalidateQueries({ queryKey: ["review-comments", taskId] });
  const cancel = () => {
    setSelection(null);
    setDraft("");
    setError("");
  };

  // The FROZEN excerpt: what the line (or range) said when commented. Stored with the comment, so if
  // the branch moves the comment still says what it was about.
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const excerptKey = (s: Selection) => `${s.path}:${s.side}:${spanOf(s).start}-${spanOf(s).end}`;

  const pick = (repo: string, path: string) => (change: ChangeData, extend: boolean) => {
    const a = changeAnchor(change);
    setError("");
    setSelection((prev) => {
      // Shift-click extends, but only in the same file AND side: a range straddling old and new
      // means nothing to the agent, who rereads its branch.
      const next: Selection =
        extend && prev && prev.path === path && prev.side === a.side
          ? { ...prev, to: a.line }
          : { repo, path, side: a.side, from: a.line, to: a.line };
      setExcerpts((ex) => ({
        ...ex,
        [excerptKey(next)]: (ex[excerptKey(next)] ?? "") || change.content.slice(0, 400),
      }));
      return next;
    });
  };

  const setOpen = (id: string, next: boolean) =>
    setOpenFiles((prev) => {
      const s2 = new Set(prev);
      if (next) s2.add(id);
      else s2.delete(id);
      return s2;
    });

  /** From the map: expand AND scroll there. Scrolling waits for the render that opens the file,
   *  or it would target a still collapsed element, at the wrong height. */
  const goTo = (repo: string, path: string) => {
    const id = `${repo}/${path}`;
    setOpen(id, true);
    setCurrent(id);
    setTimeout(() => {
      document
        .querySelector(`.${fileAnchorId(repo, path)}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  };

  const save = () => {
    if (!selection || !draft.trim() || busy) return;
    const { start, end } = spanOf(selection);
    setBusy(true);
    reviewApi
      .addReviewComment(taskId, {
        repoName: selection.repo,
        filePath: selection.path,
        side: selection.side,
        line: end,
        startLine: start === end ? null : start,
        excerpt: excerpts[excerptKey(selection)] ?? "",
        body: draft.trim(),
      })
      .then(() => {
        cancel();
        refreshComments();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const remove = (id: string) =>
    reviewApi
      .deleteReviewComment(id)
      .then(refreshComments)
      .catch((e: Error) =>
        push({ tone: "bad", title: REVIEW_TEXT.diff.removeFailed, body: e.message }),
      );
  const send = () =>
    reviewApi
      .sendReview(taskId)
      .then((r) => {
        push(
          r.launched === "queued"
            ? {
                tone: "wait",
                title: REVIEW_TEXT.diff.queuedTitle,
                body: REVIEW_TEXT.diff.queuedBody(r.count),
              }
            : {
                tone: "ok",
                title: REVIEW_TEXT.diff.sentTitle,
                body: REVIEW_TEXT.diff.sentBody(r.count),
              },
        );
        return Promise.all([refreshComments(), qc.invalidateQueries({ queryKey: qk.tasks })]);
      })
      .catch((e: Error) =>
        push({ tone: "bad", title: REVIEW_TEXT.diff.sendRefused, body: e.message }),
      );

  if (diff.isLoading) return <Caption>{REVIEW_TEXT.diff.loading}</Caption>;
  if (diff.isError) return <FormError>{String((diff.error as Error).message)}</FormError>;
  const repos = diff.data?.repos ?? [];
  const pushed = repos.filter((r) => r.files !== null);
  const span = selection ? spanOf(selection) : null;
  const rows = fileRows(pushed, comments);
  const tree = buildFileTree(rows);
  const fileCount = rows.length;
  // Folders all open on first render: the map is only useful expanded. `null` = "not decided yet";
  // once the operator closes one, their choice wins.
  const dirs = openDirs ?? new Set(allDirs(tree));

  const editor = (
    <CommentEditor
      span={span}
      path={selection?.path ?? ""}
      draft={draft}
      error={error}
      busy={busy}
      onDraft={setDraft}
      onSave={save}
      onCancel={cancel}
    />
  );

  return (
    <Stack gap={12}>
      {/* No icon here since slice nav/17: the card framing the view already carries its name and
          icon, which made two `GitCompareArrows` stacked. */}
      <Row gap={8} wrap>
        <Text size="sm">
          {REVIEW_TEXT.diff.introBefore}
          <b>{diff.data?.branch}</b>
          {REVIEW_TEXT.diff.introAfter}
        </Text>
        <Spacer />
        <IconBtn title={REVIEW_TEXT.diff.refresh} onClick={() => diff.refetch()}>
          <RefreshCw size={13} />
        </IconBtn>
        {open.length > 0 && (
          <ConfirmAction
            variant="default"
            leading={<Send size={13} />}
            label={REVIEW_TEXT.diff.send(open.length)}
            confirmLabel={REVIEW_TEXT.diff.sendConfirm}
            announce={REVIEW_TEXT.diff.sendAnnounce(open.length)}
            onConfirm={send}
          />
        )}
      </Row>

      {repos
        .filter((r) => r.error)
        .map((r) => (
          <FormError key={r.repo}>{REVIEW_TEXT.diff.repoError(r.repo, r.error!)}</FormError>
        ))}

      {pushed.length === 0 && !repos.some((r) => r.error) && (
        <Empty variant="inline" title={REVIEW_TEXT.diff.emptyTitle}>
          {REVIEW_TEXT.diff.emptyWhy}
        </Empty>
      )}

      {pushed.length > 0 && (
        <SplitPane
          ratio="aside"
          side="left"
          label={REVIEW_TEXT.diff.treeLabel}
          aside={
            <DiffTree
              nodes={tree}
              openDirs={dirs}
              current={current}
              onToggleDir={(p2) =>
                setOpenDirs(() => {
                  const s2 = new Set(dirs);
                  if (s2.has(p2)) s2.delete(p2);
                  else s2.add(p2);
                  return s2;
                })
              }
              onPick={goTo}
              footer={
                openFiles.size > 0 ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setOpenFiles(new Set());
                      setCurrent(null);
                    }}
                  >
                    {REVIEW_TEXT.diff.collapseAll}
                  </Button>
                ) : (
                  <Caption>{REVIEW_TEXT.diff.fileCount(fileCount)}</Caption>
                )
              }
            />
          }
          main={
            <Stack gap={8}>
              {pushed.map((r) => (
                <Stack key={r.repo} gap={8}>
                  {pushed.length > 1 && <Caption>{REVIEW_TEXT.diff.repo(r.repo)}</Caption>}
                  {r.files!.map((f) => (
                    <DiffFile
                      key={`${r.repo}/${f.path}`}
                      repo={r.repo}
                      path={f.path}
                      status={f.status}
                      additions={f.additions}
                      deletions={f.deletions}
                      hunks={hunksOf(f.path, f.patch)}
                      comments={comments}
                      selection={selection?.repo === r.repo ? selection : null}
                      editor={editor}
                      open={openFiles.has(`${r.repo}/${f.path}`)}
                      onOpenChange={(next) => {
                        setOpen(`${r.repo}/${f.path}`, next);
                        if (next) setCurrent(`${r.repo}/${f.path}`);
                      }}
                      onLineClick={pick(r.repo, f.path)}
                      onDelete={(c) => remove(c.id)}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          }
        />
      )}
    </Stack>
  );
}
