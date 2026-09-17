// The outbound webhooks card, presentational. Wiring (read and mutations) lives in
// `WebhooksPanel`, same split as `StandupCard`/`StandupPanel`. The global kill switch stays in the
// rail: when off, nothing is sent whatever is configured here.
import { useState } from "react";
import { Trash2, Webhook } from "lucide-react";
import { Card } from "../ui/card.js";
import { Chip, StatusChip } from "../ui/chip.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Field, Fieldset, FormError } from "../ui/form.js";
import { Row, Stack } from "../ui/flex.js";
import { Button, IconBtn, ToggleButton } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { List, ListRow } from "../ui/list.js";
import { Text } from "../ui/text.js";
import type { Webhook as WebhookRecord } from "../api/notifications.js";
import { WEBHOOKS_TEXT } from "./text-webhooks.js";

export function WebhooksCard({
  enabled,
  webhooks,
  allEvents,
  onCreate,
  onDelete,
  creating = false,
  deletingId,
  createError,
  deleteError,
}: {
  /** `undefined` = not read yet. */
  enabled?: boolean;
  webhooks: WebhookRecord[];
  allEvents: string[];
  /** Resolves on successful creation, which tells the form to clear. A rejection stays visible
   *  through `createError`. */
  onCreate: (url: string, events: string[]) => Promise<void>;
  onDelete: (id: string) => void;
  creating?: boolean;
  /** Id of the webhook being deleted (`remove.variables` on the panel side while
   *  `remove.isPending`): only its bin spins, not its neighbours'. */
  deletingId?: string;
  createError?: string;
  deleteError?: string;
}) {
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // empty = all
  const toggle = (e: string) =>
    setPicked((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]));
  return (
    <Card
      icon={<Webhook size={16} />}
      title={
        <>
          {WEBHOOKS_TEXT.title}
          {enabled !== undefined && (
            <StatusChip state={enabled ? "ok" : "idle"}>
              {enabled ? WEBHOOKS_TEXT.active : WEBHOOKS_TEXT.muted}
            </StatusChip>
          )}
        </>
      }
      desc={WEBHOOKS_TEXT.desc}
    >
      <Stack gap={12}>
        {webhooks.length === 0 ? (
          <Text tone="muted" size="sm" as="p">
            {WEBHOOKS_TEXT.noWebhooks}
          </Text>
        ) : (
          <List density="compact" label={WEBHOOKS_TEXT.registeredLabel}>
            {webhooks.map((w) => (
              <ListRow
                key={w.id}
                leading={<Webhook size={14} />}
                meta={
                  <Chip size="sm" mono title={w.events.join(", ")}>
                    {w.events.length ? w.events.join(", ") : WEBHOOKS_TEXT.allEvents}
                  </Chip>
                }
                actions={
                  <IconBtn
                    title={WEBHOOKS_TEXT.remove}
                    danger
                    loading={deletingId === w.id}
                    onClick={() => onDelete(w.id)}
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                }
              >
                <Ellipsis title={w.url}>{w.url}</Ellipsis>
              </ListRow>
            ))}
          </List>
        )}
        {deleteError && <FormError>{deleteError}</FormError>}
        <Field label={WEBHOOKS_TEXT.urlLabel} required hint={WEBHOOKS_TEXT.urlHint}>
          <Input
            placeholder={WEBHOOKS_TEXT.urlPlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Fieldset
          legend={WEBHOOKS_TEXT.eventsLegend}
          hint={
            picked.length === 0
              ? WEBHOOKS_TEXT.noneChecked
              : WEBHOOKS_TEXT.someChecked(picked.length)
          }
        >
          <Row gap={6} wrap>
            {/* Toggle buttons, not chips (14/09, operator's rule on the board: "a chip is a visual,
                not a click"). A chip states a fact, a button accepts a gesture; here you tick
                events. `aria-pressed` also tells screen readers, which a selected chip did not. */}
            {allEvents.map((e) => (
              <ToggleButton
                key={e}
                size="sm"
                pressed={picked.includes(e)}
                onPressedChange={() => toggle(e)}
              >
                {e}
              </ToggleButton>
            ))}
          </Row>
        </Fieldset>
        <Row gap={8} wrap>
          <Button
            variant="primary"
            disabled={!url.trim() || creating}
            loading={creating}
            onClick={() =>
              onCreate(url.trim(), picked)
                .then(() => {
                  setUrl("");
                  setPicked([]);
                })
                // The rejection is already visible through `createError` (mutation state, panel
                // side): this `catch` only avoids leaving a rejected promise unhandled.
                .catch(() => {})
            }
          >
            {creating ? WEBHOOKS_TEXT.adding : WEBHOOKS_TEXT.add}
          </Button>
        </Row>
        {createError && <FormError>{createError}</FormError>}
      </Stack>
    </Card>
  );
}
