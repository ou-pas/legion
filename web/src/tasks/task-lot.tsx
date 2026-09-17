// The batch of slices on screen, and the gesture approving it (breakdown spec, behaviours 5 and 6).
// Rendered on the page of a step marked "approves a batch" while in review: the only place and
// moment where the operator decides.
//
// Before pressing they read each slice with its rank, label, deliverable, validation command,
// criteria and blockers. That is where granularity is judged, hence the WHOLE batch, not a summary.
//
// The component loads and decides nothing: it gets the batch and the faults the server found. A
// faulty batch still renders, faults shown and button closed: hiding the slices would deprive the
// operator of what they must reread to understand the reproach.
import { Layers } from "lucide-react";
import type { Lot, LotSlice } from "../api/tasks.js";
import { Button } from "../ui/button.js";
import { Chip } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Row } from "../ui/flex.js";
import { List, ListItem } from "../ui/list.js";
import { Panel, PanelHeader, PanelNote } from "../ui/panel.js";
import { Caption, Text } from "../ui/text.js";
import { TASK_LOT_TEXT } from "./text/lot.js";

function SliceRow({ slice, rank }: { slice: LotSlice; rank: number }) {
  return (
    <ListItem
      as="li"
      // The RANK is rendered explicitly: in a batch a slice is referred to by its rank, and blockers
      // and faults name it by that number.
      leading={
        <Chip kind="st-neutral" mono size="sm">
          {rank}
        </Chip>
      }
      title={slice.label.trim() || TASK_LOT_TEXT.noLabel}
      meta={
        <Chip kind="st-neutral" size="sm">
          {slice.blockedBy.length > 0
            ? TASK_LOT_TEXT.blockedBy(slice.blockedBy)
            : TASK_LOT_TEXT.free}
        </Chip>
      }
      sub={`${TASK_LOT_TEXT.outcome} : ${slice.outcome}`}
    >
      <Row gap={6}>
        <Caption>{TASK_LOT_TEXT.validatedBy}</Caption>
        <Code>{slice.validatedBy}</Code>
      </Row>
      {/* The MODES only, not the criteria text: the slice page shows them in full once created.
          Here the operator judges how the slice will be proven, not the wording. */}
      <Row gap={6}>
        {slice.items.map((c, i) => (
          <Chip key={`${i}-${c.text}`} kind="st-neutral" mono size="sm">
            {c.mode === "property" && c.edge ? `${c.mode} · ${c.edge}` : c.mode}
          </Chip>
        ))}
      </Row>
    </ListItem>
  );
}

export function TaskLotPanel({
  lot,
  busy = false,
  onApprove,
}: {
  /** `null` (or `approvesLot: false`): the task is not a batch step, nothing to render. */
  lot: Lot | null;
  busy?: boolean;
  onApprove: () => void;
}) {
  if (!lot?.approvesLot) return null;
  const faulty = lot.faults.length > 0;
  return (
    <Panel>
      <PanelHeader
        icon={<Layers size={15} />}
        title={
          lot.slices.length > 0 ? TASK_LOT_TEXT.title(lot.slices.length) : TASK_LOT_TEXT.emptyTitle
        }
        actions={
          <Button variant="primary" disabled={faulty || busy} loading={busy} onClick={onApprove}>
            {busy ? TASK_LOT_TEXT.approving : TASK_LOT_TEXT.approve}
          </Button>
        }
      />
      <PanelNote tone={faulty ? "bad" : "wait"}>
        {faulty ? TASK_LOT_TEXT.refusedWhy : TASK_LOT_TEXT.why}
      </PanelNote>
      {lot.slices.length > 0 && (
        <List as="ol" label={TASK_LOT_TEXT.listLabel}>
          {lot.slices.map((s, i) => (
            <SliceRow key={i} slice={s} rank={i + 1} />
          ))}
        </List>
      )}
      {faulty && (
        <>
          <PanelNote tone="bad">
            <Text weight="semi">{TASK_LOT_TEXT.refusedTitle}</Text>
          </PanelNote>
          <List label={TASK_LOT_TEXT.faultsLabel}>
            {lot.faults.map((f) => (
              <ListItem key={f} title={f} />
            ))}
          </List>
        </>
      )}
    </Panel>
  );
}
