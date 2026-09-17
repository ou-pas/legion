// ONE diff file (pre-review), rendered by `react-diff-view` since 24/08.
//
// Why a library in a project keeping dependencies minimal: the patch parser fit in 40 lines, but
// RENDERING does not (side anchoring, widgets under a line, ranges, context expansion). The double
// display the operator saw (editor under the removed AND the added line of the same number) is the
// bug class a mature library has solved: its widgets are keyed by `getChangeKey`, which carries the
// side. We keep OUR loop (comments, sending, anchors) and delegate the diff mechanics.
//
// Theming goes through the library's CSS classes, rewritten in diff-view.css with OUR tokens.
import { FileCode2, Trash2 } from "lucide-react";
import { Diff, Hunk, getChangeKey, type ChangeData, type HunkData } from "react-diff-view";
import { type ReviewComment } from "../api/review.js";
import {
  changeAnchor,
  commentsAt,
  selectionCovers,
  withinCommented,
  type Selection,
} from "./diff-anchor.js";
import { fileAnchorId } from "./file-tree.js";
import { REVIEW_TEXT } from "./text.js";
import { IconBtn } from "../ui/button.js";
import { Chip } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Disclosure } from "../ui/disclosure.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Caption, Text } from "../ui/text.js";
import "./diff-view.css";
import { REVIEW_COMMENT_STATUS } from "../api/review.js";

/** The line where the selection ends in this file: the editor opens there and nowhere else (the
 *  bottom of a range, or the single line of a plain click). */
function endsSelection(
  selection: Selection | null,
  path: string,
  anchor: ReturnType<typeof changeAnchor>,
): boolean {
  return selection?.path === path && selection.side === anchor.side && selection.to === anchor.line;
}

/** A line's insert: its existing comments, and the editor when writing there. A sent comment can no
 *  longer be deleted: it is on the forge, and the chip says so. */
function LineWidget({
  here,
  editor,
  onDelete,
}: {
  here: ReviewComment[];
  editor?: React.ReactNode;
  onDelete: (comment: ReviewComment) => void | Promise<unknown>;
}) {
  return (
    <Stack gap={6} className="dm-diff-widget">
      {here.map((c) => (
        <Row
          key={c.id}
          gap={8}
          align="flex-start"
          className="dm-diff-note"
          data-sent={c.status === REVIEW_COMMENT_STATUS.sent || undefined}
        >
          <Stack gap={2}>
            {c.startLine !== null && (
              <Caption>{REVIEW_TEXT.file.lines(c.startLine, c.line)}</Caption>
            )}
            {/* `pre-wrap` (CSS): a multi-line comment reads as it was written. */}
            <Text size="sm" className="dm-diff-note-body">
              {c.body}
            </Text>
          </Stack>
          <Spacer />
          {c.status === REVIEW_COMMENT_STATUS.sent ? (
            <Chip size="sm">{REVIEW_TEXT.file.sent}</Chip>
          ) : (
            <IconBtn title={REVIEW_TEXT.file.removeComment} danger onClick={() => onDelete(c)}>
              <Trash2 size={12} />
            </IconBtn>
          )}
        </Row>
      ))}
      {editor}
    </Stack>
  );
}

export function DiffFile({
  repo,
  path,
  status,
  additions,
  deletions,
  hunks,
  comments,
  selection,
  editor,
  open,
  onOpenChange,
  onLineClick,
  onDelete,
}: {
  repo: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** null = patch omitted by GitHub (binary, file too big): said, not guessed. */
  hunks: HunkData[] | null;
  comments: ReviewComment[];
  /** The range being selected, if it is in THIS file. */
  selection: Selection | null;
  /** Rendered under the selection's last line. */
  editor?: React.ReactNode;
  /** COLLAPSED by default (operator request, 24/08): expanding 48 files drowns the review. Opening
   *  is driven by the page so the tree can expand a file. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** `extend` = shift-click: extends the range instead of starting a new one. */
  onLineClick: (change: ChangeData, extend: boolean) => void;
  onDelete: (comment: ReviewComment) => void | Promise<unknown>;
}) {
  const mine = comments.filter((c) => c.repoName === repo && c.filePath === path);

  // Widgets are keyed by the library's change key: side-aware by construction.
  const widgets: Record<string, React.ReactNode> = {};
  const selected: string[] = [];
  for (const hunk of hunks ?? []) {
    for (const change of hunk.changes) {
      const key = getChangeKey(change);
      const anchor = changeAnchor(change);
      if (selectionCovers(selection, path, anchor)) selected.push(key);
      const here = commentsAt(mine, path, anchor);
      const isEditorLine = Boolean(editor) && endsSelection(selection, path, anchor);
      if (here.length === 0 && !isEditorLine) continue;
      widgets[key] = (
        <LineWidget here={here} editor={isEditorLine ? editor : undefined} onDelete={onDelete} />
      );
    }
  }

  return (
    <Disclosure
      open={open}
      onOpenChange={onOpenChange}
      flush
      className={fileAnchorId(repo, path)}
      summary={
        <Row gap={8} wrap>
          <FileCode2 size={14} aria-hidden="true" />
          <Code variant="bare">{path}</Code>
          {status !== "modified" && <Chip size="sm">{status}</Chip>}
          <Caption>
            +{additions} −{deletions}
          </Caption>
          {mine.length > 0 && <Chip size="sm">{REVIEW_TEXT.file.comments(mine.length)}</Chip>}
        </Row>
      }
    >
      {hunks === null ? (
        <Caption>{REVIEW_TEXT.file.noPatch}</Caption>
      ) : (
        <Diff
          viewType="unified"
          diffType={status === "added" ? "add" : status === "removed" ? "delete" : "modify"}
          hunks={hunks}
          widgets={widgets}
          selectedChanges={selected}
          className="dm-diff"
          generateLineClassName={({ changes }) =>
            changes.some((c) => withinCommented(mine, path, changeAnchor(c)))
              ? "dm-diff-covered"
              : undefined
          }
          codeEvents={{
            onClick: ({ change }, e) => {
              if (change) onLineClick(change, e.shiftKey);
            },
          }}
          gutterEvents={{
            onClick: ({ change }, e) => {
              if (change) onLineClick(change, e.shiftKey);
            },
          }}
        >
          {(hs) => hs.map((h) => <Hunk key={h.content} hunk={h} />)}
        </Diff>
      )}
    </Disclosure>
  );
}
