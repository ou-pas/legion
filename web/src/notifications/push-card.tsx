// The phone notifications card, presentational. Wiring lives in `PushPanel`, same split as
// `WebhooksCard`/`WebhooksPanel`.
//
// It says what is missing before offering a button. The three browser states look alike and lead
// to three different gestures: install the app, open system settings, or just click. A greyed
// button without a sentence sends you hunting for a fault that does not exist.
import { BellRing, Smartphone, Trash2 } from "lucide-react";
import { Banner } from "../ui/banner.js";
import { Card } from "../ui/card.js";
import { Chip, StatusChip } from "../ui/chip.js";
import { FormError } from "../ui/form.js";
import { Row, Stack } from "../ui/flex.js";
import { Button, IconBtn } from "../ui/button.js";
import { List, ListRow } from "../ui/list.js";
import { Text } from "../ui/text.js";
import type { PushAvailability } from "./push-support.js";
import type { PushSubscriptionSummary } from "../api/notifications.js";
import { PUSH_TEXT } from "./text-push.js";

/** The sentence explaining the state, and the gesture it calls for. Out of the render so it reads
 *  as one block: it is the useful content of this card. */
function availabilityNote(availability: PushAvailability): string | null {
  switch (availability.state) {
    case "needs-home-screen":
      return PUSH_TEXT.needsHomeScreen;
    case "unsupported":
      return availability.why;
    default:
      return null;
  }
}

export function PushCard({
  availability,
  /** The global notifications kill switch (the rail bell). `undefined` = not read yet. */
  notificationsEnabled,
  permission,
  subscribed,
  busy = false,
  error,
  subscriptions,
  onEnable,
  onDisable,
  onForget,
  forgettingId,
}: {
  availability: PushAvailability;
  notificationsEnabled?: boolean;
  permission: NotificationPermission;
  /** This browser has a live subscription. */
  subscribed: boolean;
  busy?: boolean;
  error?: string | null;
  /** All subscribed devices, this one included: the server does not know which is which. */
  subscriptions: PushSubscriptionSummary[];
  onEnable: () => void;
  onDisable: () => void;
  onForget: (id: string) => void;
  forgettingId?: string;
}) {
  const note = availabilityNote(availability);
  const ready = availability.state === "ready";
  return (
    <Card
      icon={<BellRing size={16} />}
      title={
        <>
          {PUSH_TEXT.card.title}
          <StatusChip state={subscribed ? "ok" : "idle"}>
            {subscribed ? PUSH_TEXT.card.subscribed : PUSH_TEXT.card.notSubscribed}
          </StatusChip>
        </>
      }
      desc={PUSH_TEXT.card.desc}
    >
      <Stack gap={12}>
        {/* The global switch also cuts push, and it had to be said here (14/09). A subscribed
            device, a waiting question, and nothing arriving: the cause was the crossed-out bell in
            the bar, one screen away, while this card said "this device is subscribed". A valid
            subscription under a switched-off switch is a trap, not a state. */}
        {notificationsEnabled === false && (
          <Banner tone="wait" title={PUSH_TEXT.muted.title}>
            {PUSH_TEXT.muted.body}
          </Banner>
        )}
        {note && (
          <Text tone="muted" size="sm" as="p">
            {note}
          </Text>
        )}
        {/* Denial is a separate state and cannot be fixed here: once "Block" is chosen, the
            browser never reopens its dialog. Saying so avoids a click that does nothing. */}
        {ready && permission === "denied" && (
          <Text tone="muted" size="sm" as="p">
            {PUSH_TEXT.denied}
          </Text>
        )}
        {subscriptions.length === 0 ? (
          <Text tone="muted" size="sm" as="p">
            {PUSH_TEXT.noSubscriptions}
          </Text>
        ) : (
          <List density="compact" label={PUSH_TEXT.devicesLabel}>
            {subscriptions.map((s) => (
              <ListRow
                key={s.id}
                leading={<Smartphone size={14} />}
                meta={
                  <Chip size="sm" mono title={s.events.join(", ")}>
                    {s.events.length ? s.events.join(", ") : PUSH_TEXT.allEvents}
                  </Chip>
                }
                actions={
                  <IconBtn
                    title={PUSH_TEXT.forget}
                    danger
                    loading={forgettingId === s.id}
                    onClick={() => onForget(s.id)}
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                }
              >
                {s.label ?? PUSH_TEXT.deviceFallback} · …{s.endpointTail}
              </ListRow>
            ))}
          </List>
        )}
        {error && <FormError>{error}</FormError>}
        <Row gap={8} wrap>
          {subscribed ? (
            <Button disabled={busy} onClick={onDisable}>
              {PUSH_TEXT.disable}
            </Button>
          ) : (
            <Button
              variant="primary"
              leading={<BellRing size={13} />}
              disabled={!ready || permission === "denied" || busy}
              onClick={onEnable}
            >
              {PUSH_TEXT.enable}
            </Button>
          )}
        </Row>
      </Stack>
    </Card>
  );
}
