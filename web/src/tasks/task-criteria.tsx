// A task's contract on screen: its validation command, then its NUMBERED criteria with their mode
// (breakdown spec, behaviour 7). Same block, same order, as the agent reads in its brief.
//
// The component loads and decides nothing: it decodes the column as served (`criteria.ts`). An
// unreadable or missing value renders NOTHING: most tasks have no criteria, and a "no criteria"
// panel would be noise on each of them.
import { ClipboardCheck } from "lucide-react";
import { parseCriteria } from "./criteria.js";
import { Chip } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { List, ListItem } from "../ui/list.js";
import { Panel, PanelHeader, PanelNote, PanelRow } from "../ui/panel.js";
import { TASK_CRITERIA_TEXT } from "./text/criteria.js";

export function TaskCriteriaPanel({ criteria: raw }: { criteria: string | null }) {
  const criteria = parseCriteria(raw);
  if (!criteria) return null;
  return (
    <Panel>
      <PanelHeader icon={<ClipboardCheck size={15} />} title={TASK_CRITERIA_TEXT.title} />
      <PanelNote tone="wait">{TASK_CRITERIA_TEXT.why}</PanelNote>
      {/* The command FIRST, as in the column: it decides, the criteria say what to look for in its
          output. Monospace, because it gets copied. */}
      <PanelRow>
        {TASK_CRITERIA_TEXT.validatedBy} <Code>{criteria.validatedBy}</Code>
      </PanelRow>
      <List as="ol" label={TASK_CRITERIA_TEXT.listLabel}>
        {criteria.items.map((c, i) => (
          <ListItem
            key={`${i}-${c.text}`}
            as="li"
            // The POSITION is rendered explicitly rather than left to the `ol` marker: a criterion
            // is referred to by its rank, and that rank must read whatever the list styling.
            leading={
              <Chip kind="st-neutral" mono size="sm">
                {i + 1}
              </Chip>
            }
            title={c.text}
            meta={
              <Chip
                kind="st-neutral"
                mono
                size="sm"
                title={
                  c.mode === "property" && c.edge ? TASK_CRITERIA_TEXT.edge(c.edge) : undefined
                }
              >
                {c.mode === "property" && c.edge ? `${c.mode} · ${c.edge}` : c.mode}
              </Chip>
            }
          />
        ))}
      </List>
    </Panel>
  );
}
