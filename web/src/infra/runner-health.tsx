// A machine's state, as seen by the probe (01/09, multi-machine work).
//
// The pill already existed; the date was missing. Since sessions run on Macs that sleep, "docker
// unavailable" is not enough: you need to know whether the machine went quiet ten seconds or three
// days ago. The first you wait for, the second you wake up.
//
// Two sources, on purpose. `available` is what the current inspection just saw; `lastSeenAt` is what
// the server routes on, with two probe periods of hysteresis. They can only diverge in the minute
// after a state change, which is exactly when you look at this screen: hiding it would cast doubt on
// everything else.
import { StatusChip, StatusDot } from "../ui/chip.js";
import { Caption } from "../ui/text.js";
import { shortDuration } from "../ui/duration.js";
import { INFRA_TEXT } from "./text.js";

/** Two probe periods, the server threshold (`infra/probe.ts`), repeated here to name the
 *  disagreement, never to decide it: the server routes. */
const UNREACHABLE_AFTER_MS = 60_000;

/** The pill carries the age (05/09, operator feedback): "docker reachable · 23 s" as one object, the
 *  full sentence in a tooltip. The sentence used to sit next to it and pushed the header onto two
 *  lines when the host was long. `lastSeenAt` and `now` are optional: without them the pill only
 *  says the state, which is what stories do. `now` is passed in, not read here: `Date.now()` at
 *  render is impure. */
export function RunnerHealthChip({
  available,
  lastSeenAt,
  now,
}: {
  available: boolean;
  lastSeenAt?: number | null;
  now?: number;
}) {
  const t = INFRA_TEXT.health;
  const state = available ? "ok" : "bad";
  const word = available ? t.reachable : t.unreachable;
  if (lastSeenAt === undefined || now === undefined)
    return <StatusChip state={state}>{word}</StatusChip>;
  // The pill alone in a runner head (05/09, operator feedback): word and age go into the tooltip.
  if (lastSeenAt === null) return <StatusDot state={state} label={`${word} · ${t.never}`} />;
  const age = now - lastSeenAt;
  // The disagreement: inspection says no, the probe has not expired yet (or the reverse).
  const routable = age < UNREACHABLE_AFTER_MS;
  const full = `${word} · ${t.seen(shortDuration(age))}${routable !== available ? ` — ${t.lagging}` : ""}`;
  return <StatusDot state={state} label={full} />;
}

/** `now` is passed in, not read here: `Date.now()` during render is impure (oxlint `react/purity`),
 *  and freezing it at mount would age the age backwards. The screen passes its query's
 *  `dataUpdatedAt`: the last refresh instant, which moves every 10 s with no extra clock, and is
 *  exactly when what is shown was measured. */
export function RunnerLastSeen({
  available,
  lastSeenAt,
  now,
}: {
  available: boolean;
  lastSeenAt: number | null;
  now: number;
}) {
  const t = INFRA_TEXT.health;
  if (lastSeenAt === null) return <Caption>{t.never}</Caption>;
  const age = now - lastSeenAt;
  // The disagreement: inspection says no, the probe has not expired yet (or the reverse).
  const routable = age < UNREACHABLE_AFTER_MS;
  return (
    <Caption>
      {t.seen(shortDuration(age))}
      {routable !== available && ` — ${t.lagging}`}
    </Caption>
  );
}
