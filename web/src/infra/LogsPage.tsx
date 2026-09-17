// Control plane log: GET /api/control-events (read-only, no write route). A dedicated page, not
// one more card on Infra: Infra is about Docker runners an operator can clean, this log is about the
// control plane itself (boot, migrations, seed, preflight, queue, recovered sessions, integrations).
// Two objects, two surfaces (rule 9septies). A list you browse, not a live stream: refresh is
// periodic (20 s), nothing scrolls under your eyes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Braces, RefreshCw } from "lucide-react";
import { controlEventsQuery } from "../queries.js";
import { NoticesJournal } from "../inbox/notices-journal.js";
import { SYSTEM_TEXT } from "../system/text.js";
import { type ControlEvent, type ControlEventLevel } from "../api/infra.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { type ChipState, StatusChip, Tag } from "../ui/chip.js";
import { CodeBlock } from "../ui/code.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Empty } from "../ui/empty.js";
import { ErrorState } from "../ui/error-state.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { SearchInput } from "../ui/input.js";
import { LOCALE } from "../ui/locale.js";
import { Page } from "../ui/page.js";
import { Panel, PanelHeader } from "../ui/panel.js";
import { Popover } from "../ui/popover.js";
import { Select } from "../ui/select.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Table, Tbody, Td, Th, Thead, Tr } from "../ui/table.js";
import { Caption, Text } from "../ui/text.js";

const LEVEL_STATE: Record<ControlEventLevel, ChipState> = {
  info: "idle",
  warn: "wait",
  error: "bad",
};
const LEVEL_LABEL: Record<ControlEventLevel, string> = SYSTEM_TEXT.logs.levelLabel;
const LIMITS = [50, 100, 200, 500, 1000];

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function LogsPage() {
  const [level, setLevel] = useState<ControlEventLevel | "all">("all");
  const [limit, setLimit] = useState(200);
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    controlEventsQuery(level, limit),
  );

  // Client-side filter on source/message: sources are an open list (brief rule), and an exact
  // server-side filter would freeze an enumeration that does not exist.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = data ?? [];
    if (!needle) return all;
    return all.filter(
      (e) => e.source.toLowerCase().includes(needle) || e.message.toLowerCase().includes(needle),
    );
  }, [data, q]);

  // The rail's word, without an icon (header alignment, 02/09): section pages carry no title icon,
  // the rail already does, and three places name the section with the same word.
  const title = SYSTEM_TEXT.tab.logs;
  const refresh = (
    <IconBtn title={SYSTEM_TEXT.logs.refresh} onClick={() => void refetch()} loading={isFetching}>
      <RefreshCw size={14} />
    </IconBtn>
  );

  if (isLoading) {
    return (
      <Page title={title} sub={SYSTEM_TEXT.logsSub} actions={refresh}>
        <Card>
          <SkeletonText lines={6} label={SYSTEM_TEXT.logs.loading} />
        </Card>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title={title} sub={SYSTEM_TEXT.logsSub} actions={refresh}>
        <ErrorState
          title={SYSTEM_TEXT.logs.errorTitle}
          detail={error instanceof Error ? error.message : undefined}
          actions={
            <Button variant="primary" leading={<RefreshCw size={13} />} onClick={() => refetch()}>
              {SYSTEM_TEXT.logs.retry}
            </Button>
          }
        >
          {SYSTEM_TEXT.logs.errorBody}
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page title={title} sub={SYSTEM_TEXT.logsSub} actions={refresh}>
      <Stack gap={14}>
        {/* Notices first (02/09): what waits for nobody reads where you check what happened. They
            left the bar's waiting panel, which now only carries decisions. The component comes
            from the inbox domain; this page composes it without knowing notices. */}
        <NoticesJournal />
        <Row gap={10} wrap align="flex-end">
          <Field label={SYSTEM_TEXT.logs.level}>
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value as ControlEventLevel | "all")}
            >
              <option value="all">{SYSTEM_TEXT.logs.levelAll}</option>
              <option value="info">{LEVEL_LABEL.info}</option>
              <option value="warn">{LEVEL_LABEL.warn}</option>
              <option value="error">{LEVEL_LABEL.error}</option>
            </Select>
          </Field>
          <Field label={SYSTEM_TEXT.logs.limit}>
            <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Spacer />
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder={SYSTEM_TEXT.logs.filterPlaceholder}
            aria-label={SYSTEM_TEXT.logs.filterLabel}
          />
        </Row>

        {rows.length === 0 ? (
          <Card>
            <Empty
              variant="panel"
              title={
                data.length === 0 ? SYSTEM_TEXT.logs.emptyTitle : SYSTEM_TEXT.logs.noMatchTitle
              }
            >
              {data.length === 0 ? SYSTEM_TEXT.logs.emptyBody : SYSTEM_TEXT.logs.noMatchBody}
            </Empty>
          </Card>
        ) : (
          <Panel>
            <PanelHeader
              title={SYSTEM_TEXT.logs.count(rows.length)}
              actions={
                data.length === limit ? (
                  <Caption tone="muted">{SYSTEM_TEXT.logs.limitReached(limit)}</Caption>
                ) : undefined
              }
            />
            <Table label={SYSTEM_TEXT.logs.table}>
              <Thead>
                <Tr>
                  <Th>{SYSTEM_TEXT.logs.thLevel}</Th>
                  <Th>{SYSTEM_TEXT.logs.thSource}</Th>
                  <Th>{SYSTEM_TEXT.logs.thMessage}</Th>
                  <Th>
                    <span className="ui-sr">{SYSTEM_TEXT.logs.thDetail}</span>
                  </Th>
                  <Th align="num">{SYSTEM_TEXT.logs.thTime}</Th>
                </Tr>
              </Thead>
              <Tbody cols={5}>
                {rows.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </Tbody>
            </Table>
          </Panel>
        )}
      </Stack>
    </Page>
  );
}

function EventRow({ event }: { event: ControlEvent }) {
  return (
    <Tr>
      <Td>
        <StatusChip state={LEVEL_STATE[event.level]} size="sm">
          {LEVEL_LABEL[event.level]}
        </StatusChip>
      </Td>
      <Td>
        <Tag>{event.source}</Tag>
      </Td>
      <Td>
        <Ellipsis>{event.message}</Ellipsis>
      </Td>
      <Td>
        {event.payload != null && (
          <Popover
            label={SYSTEM_TEXT.logs.payload(event.id, event.source)}
            align="end"
            trigger={
              <Tag>
                <Braces size={12} aria-hidden="true" />
              </Tag>
            }
          >
            <CodeBlock variant="scroll" label={SYSTEM_TEXT.logs.payloadShort(event.id)}>
              {JSON.stringify(event.payload, null, 2)}
            </CodeBlock>
          </Popover>
        )}
      </Td>
      <Td align="num">
        <Text tone="muted" size="xs">
          {fmtTime(event.createdAt)}
        </Text>
      </Td>
    </Tr>
  );
}
