// Open legion/* change requests (GitHub PR, GitLab MR) and their comments. Clicking a comment gives
// a prefilled fix task on the SAME branch as the PR (the agent fixes, pushes, the PR updates).
import { useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, GitPullRequest, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { reviewApi, type OpenPr, type PrComment } from "../api/review.js";
import { type Project } from "../api/projects.js";
import { QuickTaskModal } from "../tasks/quick-task-modal.js";
import { MergeStateChip } from "./merge-state-chip.js";
import { Button, IconBtn } from "../ui/button.js";
import { Badge, Tag } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Empty } from "../ui/empty.js";
import { ErrorState } from "../ui/error-state.js";
import { Stack } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { List, ListItem } from "../ui/list.js";
import { Page } from "../ui/page.js";
import { Panel, PanelHeader, PanelNote } from "../ui/panel.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Card } from "../ui/card.js";
import { useProject } from "../projects/project.js";
import { REVIEW_TEXT } from "./text.js";

const prsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["github-prs", projectId] as const,
    queryFn: () => reviewApi.githubPrs(projectId),
    enabled: projectId.length > 0,
    staleTime: 60_000,
    retry: false,
  });

export function ReviewsPage() {
  const { project, projectId } = useProject();
  const navigate = useNavigate();
  const {
    data: prs,
    error,
    isLoading,
    refetch,
    isFetching,
  } = useQuery(prsQuery(project?.id ?? ""));
  const [creating, setCreating] = useState<{ pr: OpenPr; comment: PrComment } | null>(null);

  // The server names the missing secret: an empty state with a way out, not a failure.
  const message = error instanceof Error ? error.message : error ? String(error) : "";
  const missingToken = message.includes("GITHUB_TOKEN");
  // A project's secrets live in the project settings, not in the library.
  const openSecrets = () =>
    projectId && void navigate({ to: "/p/$projectId/project/secrets", params: { projectId } });

  return (
    <Page
      title={REVIEW_TEXT.page.title}
      sub={REVIEW_TEXT.page.sub}
      actions={
        <IconBtn
          title={REVIEW_TEXT.page.refresh}
          onClick={() => void refetch()}
          loading={isFetching}
        >
          <RefreshCw size={14} />
        </IconBtn>
      }
    >
      <Stack gap={14}>
        {isLoading && (
          <Card>
            <SkeletonText lines={5} label={REVIEW_TEXT.page.loading} />
          </Card>
        )}

        {!isLoading && missingToken && (
          <Card>
            <Empty
              variant="panel"
              title={REVIEW_TEXT.page.noTokenTitle}
              action={
                <Button variant="primary" onClick={openSecrets}>
                  {REVIEW_TEXT.page.noTokenAction}
                </Button>
              }
            >
              {REVIEW_TEXT.page.noTokenBefore}
              <Code>GITHUB_TOKEN</Code>
              {REVIEW_TEXT.page.noTokenAfter}
            </Empty>
          </Card>
        )}

        {!isLoading && error && !missingToken && (
          <ErrorState
            title={REVIEW_TEXT.page.failedTitle}
            detail={message}
            actions={
              <>
                <Button
                  variant="primary"
                  leading={<RefreshCw size={13} />}
                  onClick={() => refetch()}
                >
                  {REVIEW_TEXT.page.retry}
                </Button>
                <Button onClick={openSecrets}>{REVIEW_TEXT.page.checkSecret}</Button>
              </>
            }
          >
            {REVIEW_TEXT.page.failedWhy}
          </ErrorState>
        )}

        {prs && prs.length === 0 && (
          <Card>
            <Empty variant="panel" art="cleared" title={REVIEW_TEXT.page.noPrTitle}>
              {REVIEW_TEXT.page.noPrWhy}
            </Empty>
          </Card>
        )}

        {(prs ?? []).map((pr) => (
          <PrPanel
            key={`${pr.repo}#${pr.number}`}
            pr={pr}
            onFix={(comment) => setCreating({ pr, comment })}
          />
        ))}
      </Stack>
      {/* The popup belongs to the tasks domain (`tasks/quick-task-modal.tsx`) since 06/09; it was
          written here AND in the Issues screen. What stays here is about the PR: its title, the
          proposed name, the comment, the brief, the reference carrying ITS branch. */}
      {creating && (
        <FixTaskModal project={project} fix={creating} onClose={() => setCreating(null)} />
      )}
    </Page>
  );
}

/** A comment's fix task: it quotes the remark and takes THE PR's branch, so the push updates the PR
 *  instead of opening a second one. */
function FixTaskModal({
  project,
  fix,
  onClose,
}: {
  project: Project | null;
  fix: { pr: OpenPr; comment: PrComment };
  onClose: () => void;
}) {
  return (
    <QuickTaskModal
      project={project}
      title={REVIEW_TEXT.fix.title(fix.pr.repo, fix.pr.number)}
      defaultName={REVIEW_TEXT.fix.defaultName(
        fix.pr.repo,
        fix.pr.number,
        fix.comment.body.slice(0, 60),
      )}
      defaultGate={false}
      preview={{
        label: REVIEW_TEXT.fix.commentBlock(fix.comment.author),
        body: fix.comment.body,
      }}
      description={REVIEW_TEXT.fix.brief({
        author: fix.comment.author,
        repo: fix.pr.repo,
        number: fix.pr.number,
        path: fix.comment.path ? REVIEW_TEXT.fix.briefPath(fix.comment.path) : "",
        body: fix.comment.body,
        url: fix.comment.url,
      })}
      externalRef={{
        provider: "github-comment",
        issueId: fix.comment.id,
        identifier: `${fix.pr.repo}#${fix.pr.number}`,
        url: fix.comment.url,
        branch: fix.pr.branch, // the fix reuses THE PR's branch
      }}
      hint={
        <>
          {REVIEW_TEXT.fix.branchBefore}
          <Code>{fix.pr.branch}</Code>
          {REVIEW_TEXT.fix.branchAfter}
        </>
      }
      onClose={onClose}
    />
  );
}

/** ONE change request and its comments: repository, branch, merge state, and each remark with the
 *  way out that turns it into a task. The page only decides what to show when there are none, or
 *  when the forge did not answer. */
function PrPanel({ pr, onFix }: { pr: OpenPr; onFix: (comment: PrComment) => void }) {
  return (
    <Panel>
      <PanelHeader
        icon={<GitPullRequest size={15} />}
        title={pr.title}
        actions={
          <Badge
            count={pr.comments.length}
            tone={pr.comments.length > 0 ? "wait" : "neutral"}
            label={REVIEW_TEXT.page.commentCount(pr.comments.length)}
          />
        }
      >
        <Link href={pr.url} target="_blank" rel="noreferrer" variant="plain">
          <Code variant="bare">
            {pr.repo}#{pr.number}
          </Code>
        </Link>
        <Tag title={REVIEW_TEXT.page.branch(pr.branch)}>{pr.branch}</Tag>
        <MergeStateChip state={pr.mergeState} />
      </PanelHeader>
      {pr.comments.length === 0 ? (
        <PanelNote>{REVIEW_TEXT.page.noComment}</PanelNote>
      ) : (
        <List label={REVIEW_TEXT.page.commentList(pr.repo, pr.number)}>
          {pr.comments.map((cm) => (
            <ListItem
              key={cm.id}
              leading={<MessageSquare size={15} />}
              title={cm.body}
              sub={cm.path ? REVIEW_TEXT.page.commentSub(cm.author, cm.path) : cm.author}
              actions={
                <>
                  <Link
                    href={cm.url}
                    target="_blank"
                    rel="noreferrer"
                    variant="plain"
                    aria-label={REVIEW_TEXT.page.openOnGitHub(cm.author)}
                  >
                    <ExternalLink size={13} />
                  </Link>
                  <Button leading={<Plus size={12} />} onClick={() => onFix(cm)}>
                    {REVIEW_TEXT.page.createFixTask}
                  </Button>
                </>
              }
            />
          ))}
        </List>
      )}
    </Panel>
  );
}
