// The control log's store (11/09, structure review, lot 13, section S2).
//
// `logControlEvent` stays implemented in `shared/db.ts`: it logs the migration summary on first
// boot, before any domain is a stable dependency. Moving it here would create
// `shared/db.ts → events/control-log-store.ts` while this file already imports `shared/db.ts`: a
// cycle, and a `shared` → domain edge that `shared-is-a-leaf` forbids.
//
// What this file solves: `domain-rule-files-do-not-query` forbids rule files from importing
// `shared/db.ts`, and cannot tell a log line from a business query. Before this file every domain
// that logged needed its own store just to re-export this function (24 re-exports on `main`, two
// stores that existed only for it). Convention, not enforced by a gate: rule files that log import
// from here; non-rule files (notifiers, lifecycle, internal routes, index) may use `shared/db.js`.
import { logControlEvent } from "../shared/db.js";

export { logControlEvent };
