// Notices in the logs (02/09). They lived in the bar's waiting panel, but a notice stops nobody: it is
// history by nature (a standup is ready, a slice is done), and mixing it with what awaits a decision
// drowned the panel (operator feedback). They are read where one checks what happened, System › Logs,
// which COMPOSES this component without knowing the inbox; it lives here, with the domain that knows
// what a notice is.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, X } from "lucide-react";
import { inboxApi } from "../api/inbox.js";
import { noticesQuery } from "../queries.js";
import { IconBtn } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { Markish } from "../ui/markish.js";
import { Panel, PanelHeader, PanelRow } from "../ui/panel.js";
import { Text } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { INBOX_TEXT } from "./text.js";

export function NoticesJournal() {
  const { data: notices = [] } = useQuery(noticesQuery);
  const qc = useQueryClient();
  const { push } = useToast();
  return (
    <NoticesJournalView
      notices={notices}
      onRead={(id) =>
        inboxApi
          .markNoticeRead(id)
          .then(() => qc.invalidateQueries({ queryKey: ["notices"] }))
          .catch((e: Error) =>
            push({ tone: "bad", title: INBOX_TEXT.page.markReadFailed, body: e.message }),
          )
      }
    />
  );
}

/** The same surface without network: the form stories show. */
export function NoticesJournalView({
  notices,
  onRead,
}: {
  notices: { id: string; body: string }[];
  /** Returning the promise (rather than `void`ing it) lets the icon button spin during the call, see
   *  `ui/button.tsx`. */
  onRead: (id: string) => void | Promise<unknown>;
}) {
  // No notice = no panel: an empty frame atop the logs would say something is missing.
  if (notices.length === 0) return null;
  return (
    <Panel>
      <PanelHeader icon={<CheckCheck size={15} />} title={INBOX_TEXT.page.notices} />
      {notices.map((n) => (
        <PanelRow key={n.id} align="start">
          {/* Standups arrive as line-based text: each line is a paragraph, or the summary folds into
              one unreadable block. */}
          <Stack gap={2} flex={1} minWidth={0}>
            {n.body.split("\n").map((line, i) => (
              <Text key={`${n.id}-${i}`} as="p" size="sm">
                <Markish text={line} />
              </Text>
            ))}
          </Stack>
          <IconBtn title={INBOX_TEXT.page.markRead} onClick={() => onRead(n.id)}>
            <X size={14} />
          </IconBtn>
        </PanelRow>
      ))}
    </Panel>
  );
}
