// Reads a `throttle` event of kind `rate_limit` as the runner writes it into a session trace. One
// shared interpretation (night review #7): `utilization` comes as 0-1 or 0-100 depending on the
// schema generation, `resetsAt` as epoch seconds, epoch milliseconds or ISO. The trace row and its
// text version must show the same number.

export function normalizeRateLimit(d: { utilization?: unknown; resetsAt?: unknown }): {
  pct: number | null;
  reset: Date | null;
} {
  let pct: number | null = null;
  if (typeof d.utilization === "number")
    pct = Math.round(d.utilization <= 1 ? d.utilization * 100 : d.utilization);
  let reset: Date | null = null;
  if (typeof d.resetsAt === "number")
    reset = new Date(d.resetsAt > 1e12 ? d.resetsAt : d.resetsAt * 1000); // > 1e12 → already ms
  else if (typeof d.resetsAt === "string") {
    const t = new Date(d.resetsAt);
    if (!Number.isNaN(t.getTime())) reset = t;
  }
  return { pct, reset };
}
