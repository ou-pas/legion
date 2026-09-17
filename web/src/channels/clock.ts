// A turn's time. A conversation is dated to the minute: seconds belong to a trace, not a thread one
// rereads.
import { LOCALE } from "../ui/locale.js";

const HHMM = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** `undefined` when the event has no timestamp: an invented time would be a lie. */
export const atTime = (ts?: number): string | undefined =>
  ts === undefined ? undefined : HHMM.format(new Date(ts));
