// The version known when the page loaded (02/09).
//
// "On the first successful /api/version after the outage, if `current` differs from the one known
// when the page loaded" (brief #74-bis). The key word is loaded: not the last value seen, but the
// one that existed when this bundle started. A module variable holds exactly that: set once, on the
// first response after this file runs, and nothing moves it until the page reloads.
//
// No `localStorage`: the page starts from scratch on every reload, on purpose (#57: no automatic
// reload, so nothing surviving an F5 is worth keeping).
let bootVersion: string | null | undefined; // `undefined` = not set yet

/** Sets the reference version, once; later responses no longer move it. */
export function noteBootVersion(current: string | null): void {
  if (bootVersion === undefined) bootVersion = current;
}

/** Is `current` a return with a version different from the one at load? `null` on both sides
 *  compares nothing: a never-tagged repository has no version to compare, and announcing a "return"
 *  on `null !== null` would be wrong both ways. */
export function isNewerThanBoot(current: string | null): boolean {
  return (
    bootVersion !== undefined && bootVersion !== null && current !== null && current !== bootVersion
  );
}

/** For tests: a page starting from scratch. */
export function resetBootVersionForTest(): void {
  bootVersion = undefined;
}
