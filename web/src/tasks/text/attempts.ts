// The text of the past attempts disclosure (13/09).
//
// "ATTEMPT" and not "session", and the word is chosen: a task can carry several sessions without
// having been attempted several times — resuming turns is the same attempt going on. This
// disclosure only lists DISTINCT lines, so real attempts, and the word has to say that
// difference rather than point at a runtime object.
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const TASK_ATTEMPTS_TEXT = defineText({
  count: (n: number) => `${n} ${plural(n, "attempt")} before this one`,
  failed: (n: number) => `${n} failed`,
});
