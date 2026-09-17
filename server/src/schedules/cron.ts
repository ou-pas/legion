// Parse a cron expression and say when it fires (26/08).
//
// Pure: the caller passes the starting instant, so 29 February or a DST night are testable.
//
// Everything is UTC, no option. The stored rule depends on no time zone: `0 9 * * 1` fires at the
// same absolute instant wherever the machine is, and summer time does not shift it. The price is
// accepted: "9:00" means 9:00 UTC, and the screen says so.
//
// No dependency: `cron-parser` is 200 KB for seconds, `@daily` aliases, zones and six fields. We
// read five fields typed by one person, and code that decides to run an agent should be readable
// end to end.

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Whether the field was `*`: the day-of-month / day-of-week rule depends on it. */
  domStar: boolean;
  dowStar: boolean;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const;

interface CronPart {
  lo: number;
  hi: number;
  step: number;
}

// One comma-separated part: `*`, `5`, `9-17`, a step on the star, `9-17/2`. `null` on anything
// else: an expression we do not understand is refused, never guessed.
function parsePart(part: string, min: number, max: number): CronPart | null {
  const [body, stepRaw] = part.split("/");
  if (stepRaw !== undefined && !/^\d+$/.test(stepRaw)) return null;
  const step = stepRaw === undefined ? 1 : Number(stepRaw);
  if (step < 1) return null;
  let lo: number, hi: number;
  if (body === "*") {
    lo = min;
    hi = max;
  } else if (/^\d+$/.test(body ?? "")) {
    lo = Number(body);
    // `5/15` means 5 to max by 15: a step applies to a range.
    hi = stepRaw === undefined ? lo : max;
  } else {
    const m = /^(\d+)-(\d+)$/.exec(body ?? "");
    if (!m) return null;
    lo = Number(m[1]);
    hi = Number(m[2]);
  }
  if (lo < min || hi > max || lo > hi) return null;
  return { lo, hi, step };
}

// One unreadable part refuses the whole field.
function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const bounds = parsePart(part, min, max);
    if (!bounds) return null;
    for (let v = bounds.lo; v <= bounds.hi; v += bounds.step) out.add(v);
  }
  return out.size ? out : null;
}

/** Five space-separated UTC fields. `null` means invalid: accepting a doubtful expression would run
 *  an agent at a time nobody asked for. */
export function parseCron(expr: string): CronSpec | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0]!, ...RANGES.minute);
  const hour = parseField(f[1]!, ...RANGES.hour);
  const dayOfMonth = parseField(f[2]!, ...RANGES.dayOfMonth);
  const month = parseField(f[3]!, ...RANGES.month);
  // Sunday is 0 or 7; both exist in the wild.
  const dowRaw = parseField(f[4]!.replace(/\b7\b/g, "0"), ...RANGES.dayOfWeek);
  if (!minute || !hour || !dayOfMonth || !month || !dowRaw) return null;
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dowRaw,
    domStar: f[2] === "*",
    dowStar: f[4] === "*",
  };
}

/**
 * When both are restricted, day-of-month and day-of-week combine with OR, not AND (POSIX):
 * `0 0 1 * 1` fires on the 1st and every Monday. Ignoring it silently misses runs.
 */
export function cronMatches(spec: CronSpec, at: Date): boolean {
  if (!spec.minute.has(at.getUTCMinutes())) return false;
  if (!spec.hour.has(at.getUTCHours())) return false;
  if (!spec.month.has(at.getUTCMonth() + 1)) return false;
  const domHit = spec.dayOfMonth.has(at.getUTCDate());
  const dowHit = spec.dayOfWeek.has(at.getUTCDay());
  if (spec.domStar && spec.dowStar) return true;
  if (spec.domStar) return dowHit;
  if (spec.dowStar) return domHit;
  return domHit || dowHit;
}

/** A valid expression always fires within four years (29 February is the worst case); beyond
 *  that it never fires (`0 0 30 2 *`), so we return `null` rather than loop. */
const MAX_STEPS = 4 * 366 * 24 * 60;

/**
 * The next instant STRICTLY after `afterMs`. Advances by the largest non-matching field (month,
 * day, hour, minute) rather than minute by minute: a yearly `0 3 1 1 *` takes a few dozen
 * iterations, not half a million.
 */
export function nextRun(spec: CronSpec, afterMs: number): number | null {
  const d = new Date(Math.floor(afterMs / 60_000) * 60_000 + 60_000);
  d.setUTCSeconds(0, 0);
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    if (!spec.month.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const domHit = spec.dayOfMonth.has(d.getUTCDate());
    const dowHit = spec.dayOfWeek.has(d.getUTCDay());
    const dayHit =
      spec.domStar && spec.dowStar
        ? true
        : spec.domStar
          ? dowHit
          : spec.dowStar
            ? domHit
            : domHit || dowHit;
    if (!dayHit) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hour.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minute.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d.getTime();
  }
  return null;
}

/** `null` if the expression is invalid or never fires: either way there is no next run. */
export function nextRunOf(expr: string, afterMs: number): number | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, afterMs) : null;
}
