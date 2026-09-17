// Where a runner measurement comes from: `vm` is what Docker consumes (the daemon's VM), `host` what
// the MACHINE consumes. On a Mac the second includes the first plus everything else; confusing them
// would read a local compile spike as a runaway session.
import type { schema } from "../../shared/db.js";

export type MetricSource = (typeof schema.runnerMetrics.$inferSelect)["source"];
export const METRIC_SOURCE = {
  /** The Docker daemon's VM: what containers consume. */
  vm: "vm",
  /** The whole machine, sessions AND the rest of the system. */
  host: "host",
} as const satisfies Record<string, MetricSource>;
export const METRIC_SOURCES = [METRIC_SOURCE.vm, METRIC_SOURCE.host] as const;
