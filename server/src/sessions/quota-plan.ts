// After an out-of-quota stop: switch to another account, or sleep until the reset.
//
// Without database or clock, which is what makes it testable. `quota-pause.ts` reads the state
// (which account served, what is exhausted, what remains) and files the inbox entry; here we only
// decide the wake-up time and the sentence with it.
//
// Switching is FREE: the credential is reread at every container start, so resuming on another
// account needs no resume code, only a different wake-up time.

/** Margin after `resets_at`: the quota clock is not ours. Resuming a minute early would waste a
 *  resume: the session would restart only to die at once (covered, it would pause again with the new
 *  time, but no need to pay that at every reset). */
export const WAKE_MARGIN_MS = 3 * 60_000;

export interface QuotaRejection {
  window: string;
  /** null when the SDK gave no `resets_at`: the pause still exists, the wake-up is manual, and the
   *  inbox entry says so plainly. */
  resetsAt: Date | null;
}

export interface QuotaPauseInput {
  rejection: QuotaRejection;
  /** The account that just died, as the session recorded it. `null` = fallback (unranked project
   *  secret, control plane environment): nothing to exhaust, nothing to replace. */
  exhausted: { credentialId: string | null; label: string | null };
  /** What resolution returns NOW, including the exhaustion just written. */
  next: {
    credentialId: string | null;
    label: string | null;
    available: boolean;
    retryAt: Date | null;
  };
  now: number;
}

export interface QuotaPausePlan {
  /** The wake-up time set on the inbox entry. `null` = manual wake-up (no reset given and nobody
   *  else to try). */
  wakeAt: Date | null;
  body: string;
  /** The account taking over, if any. For the trace, not the decision. */
  switchTo: string | null;
}

const WINDOW_LABEL: Record<string, string> = {
  five_hour: "5 h",
  seven_day: "week",
  seven_day_opus: "week (opus)",
};
const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const account = (label: string | null): string => (label ? `“${label}”` : "the subscription");

/** Resume at once on the next account, or sleep until the nearest reset.
 *
 *  No A → B → A loop. Two guards, both needed:
 *
 *   · exhaustion is written BEFORE this decision, so resolution already excluded the account that
 *     just died: the main guard;
 *   · switching only happens if the returned account is ANOTHER one, covering the case where nothing
 *     could be written (no reset time, or the session ran on a fallback). Without it an immediate
 *     resume would restart on the same account, die at once and start over, each round costing a
 *     container start. */
export function planQuotaPause({
  rejection,
  exhausted,
  next,
  now,
}: QuotaPauseInput): QuotaPausePlan {
  const window = WINDOW_LABEL[rejection.window] ?? rejection.window;
  const impasse = `Nothing is lost: the work is pushed to the branch and the conversation is preserved.`;

  const switching =
    next.available && next.credentialId !== null && next.credentialId !== exhausted.credentialId;
  if (switching)
    // Wake-up AT THE CURRENT TIME rather than a live resume: the scheduler tick picks it up through
    // the same path as every other wake-up. Resuming from the end of the session that just died
    // would restart it from its own exit code.
    return {
      wakeAt: new Date(now),
      switchTo: next.credentialId,
      body:
        `Out of quota on ${account(exhausted.label)} — the ${window} window is exhausted. ` +
        `I switch to ${account(next.label)} and pick up right away. ${impasse}`,
    };

  // Nobody else: sleep. The reset that counts is the NEAREST among the project's credentials
  // (`retryAt`), not only the dead account's: another may reopen first, and sleeping until the dead
  // one's reset would lose the hours between them.
  const reset = next.retryAt ?? rejection.resetsAt;
  if (!reset)
    return {
      wakeAt: null,
      switchTo: null,
      body:
        `Out of quota — the ${window} window of ${account(exhausted.label)} is exhausted, and the SDK gave no reset time. ` +
        `Answer this entry to start me again once the quota is back.`,
    };

  const wakeAt = new Date(Math.max(reset.getTime(), now) + WAKE_MARGIN_MS);
  const others =
    next.credentialId !== null && next.credentialId !== exhausted.credentialId
      ? ` The other credentials of the project are exhausted too; ${account(next.label)} reopens first.`
      : "";
  return {
    wakeAt,
    switchTo: null,
    body:
      `Out of quota — the ${window} window of ${account(exhausted.label)} is exhausted.${others} ` +
      `I resume on my own ${WHEN.format(wakeAt)}; answering before that wakes me right away. ${impasse}`,
  };
}
