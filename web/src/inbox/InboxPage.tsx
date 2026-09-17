// Inbox: the only channel where agents interrupt the operator. A LIST (07/09), one row per question
// with its state at a glance; the questionnaire lives on the question page (three open rounds used to
// be six thousand pixels).
//
// Three sections naming their tier (`inbox-order.ts`): what awaits a decision, what will wake by
// itself, passive notices. Without subheadings a sort is an unexplained order.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { inboxApi } from "../api/inbox.js";
import { inboxQuery, noticesQuery } from "../queries.js";
import { useToast } from "../ui/toast.js";
import { InboxCardRow } from "./inbox-card.js";
import { inTier } from "./inbox-order.js";
import { isRoundForm } from "./round-shape.js";
import { INBOX_TEXT } from "./text.js";
import { IconBtn } from "../ui/button.js";
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { Markish } from "../ui/markish.js";
import { Page, Section } from "../ui/page.js";
import { Panel, PanelRow } from "../ui/panel.js";
import { Text } from "../ui/text.js";

export function InboxPage() {
  // The SAME screen serves `/inbox` (all projects) and `/p/<project>/inbox` (project rail). The latter
  // reads its project from the URL; the queue is global server-side, filtering happens here.
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const { data: allInbox = [] } = useQuery(inboxQuery);
  const inbox = projectId ? allInbox.filter((item) => item.projectId === projectId) : allInbox;
  const { data: notices = [] } = useQuery(noticesQuery);
  const qc = useQueryClient();
  const { push } = useToast();
  // Frozen at mount: `Date.now()` during render is impure (oxlint react/purity).
  const [now] = useState(() => Date.now());

  const needsYou = inTier(inbox, "draft").concat(inTier(inbox, "fresh"));
  const waiting = inTier(inbox, "notice");

  return (
    <Page title={INBOX_TEXT.page.title} sub={INBOX_TEXT.page.sub}>
      {needsYou.length > 0 && (
        <>
          <Section title={INBOX_TEXT.list.needsYou} count={needsYou.length} />
          <Panel>
            {needsYou.map((item) => (
              <InboxCardRow
                key={item.id}
                item={item}
                now={now}
                // The row leads to the question PAGE, never a form expanded in the list (07/09).
                // The queue is global, so the item carries its project (`item.projectId`). ONLY A
                // ROUND has a page: an out-of-quota notice linked here opened an empty page.
                render={
                  isRoundForm(item.form)
                    ? (props) => (
                        <Link
                          to="/p/$projectId/inbox/$inboxId"
                          params={{ projectId: item.projectId, inboxId: item.id }}
                          {...props}
                        />
                      )
                    : undefined
                }
              />
            ))}
          </Panel>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <Section title={INBOX_TEXT.list.waiting} count={waiting.length} />
          <Panel>
            {waiting.map((item) => (
              <InboxCardRow key={item.id} item={item} now={now} />
            ))}
          </Panel>
        </>
      )}

      {notices.length > 0 && (
        <>
          <Section title={INBOX_TEXT.page.notices} count={notices.length} />
          <Panel>
            {notices.map((n) => (
              <PanelRow key={n.id} align="start">
                {/* Standups arrive as line-based text: each line is a paragraph, or the summary
                    folds into one unreadable block. */}
                <Stack gap={2} flex={1} minWidth={0}>
                  {n.body.split("\n").map((line, i) => (
                    <Text key={`${n.id}-${i}`} as="p" size="sm">
                      <Markish text={line} />
                    </Text>
                  ))}
                </Stack>
                <IconBtn
                  title={INBOX_TEXT.page.markRead}
                  onClick={() =>
                    inboxApi
                      .markNoticeRead(n.id)
                      .then(() => qc.invalidateQueries({ queryKey: ["notices"] }))
                      .catch((e: Error) =>
                        push({
                          tone: "bad",
                          title: INBOX_TEXT.page.markReadFailed,
                          body: e.message,
                        }),
                      )
                  }
                >
                  <X size={14} />
                </IconBtn>
              </PanelRow>
            ))}
          </Panel>
        </>
      )}

      {inbox.length === 0 && notices.length === 0 && (
        <Empty variant="page" art="cleared" title={INBOX_TEXT.page.empty.title} />
      )}
    </Page>
  );
}
