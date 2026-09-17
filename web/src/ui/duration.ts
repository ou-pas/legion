/** Plain duration: "3 min", "2 h 14", "3 d". Past a day, minutes say nothing. Knows nothing of the
 *  domain, it formats milliseconds. */
export function humanDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `${h} h` : `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d`;
}

/** Same, but shows seconds under a minute. `humanDuration` rounds to minutes, right for a wait
 *  and wrong for a short measured interval: a 20 s work band read "0 min", work that never
 *  happened. Two functions rather than a flag: the caller names what it measures. */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : humanDuration(ms);
}
