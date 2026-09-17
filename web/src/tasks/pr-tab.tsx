// PR flow (v8): preview of the `pr.md` draft written by the agent; human approval opens the change
// requests through each repo's forge API (one per repo actually pushed).
//
// This view carries no gesture since 15/09 (operator request). The buttons sit in the card header
// bar (`PrActions`, mounted by `PrScreen`), where the eye looks for them and where they match the
// channel. Only what is READ remains: what a repair will cost, the draft, and the target branch.
import { useEffect, useState } from "react";
import { tasksApi, type Task } from "../api/tasks.js";
import { PrRepairNotice } from "../review/pr-repair.js";
import { Tag } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { Heading } from "../ui/heading.js";
import { Markdownish } from "../ui/markdownish.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Text } from "../ui/text.js";
import { parsePrDraft, PR_DRAFT, type PrUrl } from "./pr-state.js";
import { taskBranch } from "./task-branch.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

const T = TASK_PAGE_TEXT.pr;

export function PrTab({
  task,
  prUrls,
  initialDraft = null,
}: {
  task: Task;
  prUrls: PrUrl[];
  /** The already known draft. For the workshop: the app loads it itself. Same pattern as
   *  `SteerField`'s `defaultText`, showing an API-dependent state without a story calling the API. */
  initialDraft?: string | null;
}) {
  const [draft, setDraft] = useState<string | null>(initialDraft);
  useEffect(() => {
    fetch(tasksApi.artifactUrl(task.id, PR_DRAFT))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setDraft)
      .catch(() => setDraft(initialDraft));
  }, [task.id, initialDraft]);

  const { title, body } = parsePrDraft(draft);
  const branch = taskBranch(task);

  return (
    <Stack gap={12}>
      {/* What the bar's "Resolve" or "Fix" button will do, in writing: a click reruns a session, so
          time and money, which must not be discovered afterwards. Nothing when the PR has nothing
          to repair. */}
      <PrRepairNotice taskId={task.id} prUrls={prUrls} />
      {draft === null ? (
        <Empty variant="panel" title={T.emptyTitle}>
          {T.emptyBefore}
          <Code variant="bare">pr.md</Code>
          {T.emptyAfter}
        </Empty>
      ) : (
        <>
          <Heading level={3}>{title || T.noTitle}</Heading>
          {/* The body is Markdown, which is what the forge will make of it. Until 05/09 it showed as
              a raw code block, asterisks and table pipes visible (operator feedback). In its OWN
              pane: an agent draft easily runs eighty lines, and the diff sits below it. */}
          <ScrollArea size="md" label={T.bodyLabel}>
            <Markdownish text={body || T.noBody} />
          </ScrollArea>
        </>
      )}
      {/* The branch sentence promises no opening: it says where the code will land, including on a
          task that has pushed nothing yet. */}
      <Text size="sm" tone="muted">
        {branch ? (
          <>
            {T.branchBefore}
            <Tag>{branch}</Tag>
            {T.branchAfter}
          </>
        ) : (
          T.noBranch
        )}
      </Text>
    </Stack>
  );
}
