// The only write of `notifiers.ts`: a control event when a notifier fails.
import { logControlEvent } from "../shared/db.js";

export function logNotifierFailure(inboxId: string, message: string): void {
  logControlEvent("error", "notify", `announcing an inbox entry failed: ${message}`, {
    inboxId,
  });
}
