// Can this input BE an id? (26/08)
//
// A client-side copy of the server rule (`server/src/http/lookup.ts`), duplicated on purpose: it
// avoids round trips, since otherwise every letter typed in the palette would query the database.
// The server stays the authority on what an id DESIGNATES; here we only decide whether asking is
// worth it.
//
// It accepts a whole URL, because that is what the clipboard holds: copy the address bar, open ⌘K,
// paste. Accepting only `CuoCofyaaW` and not `http://localhost:5173/tasks/CuoCofyaaW` would force
// hand-editing what was just pasted, the very work the palette exists to avoid.

/** Product nanoids are 10 characters; the range is wider to tolerate an id of another length
 *  without it looking like a failure. */
const ID_SHAPE = /^[A-Za-z0-9_-]{6,24}$/;

export function idCandidate(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const last = raw.includes("/")
    ? (raw.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "")
    : raw;
  return ID_SHAPE.test(last) ? last : null;
}
