// Debounced draft saving (07/09). What the hook guarantees:
//
//  · ONE WRITE PER PAUSE, not per keystroke: 500 ms after the last change. A `PATCH` per character
//    would write a `session_events` row per character into a trace read in a channel.
//  · LAST WRITE WINS. The draft is REPLACED server-side, not merged: two crossing requests would let
//    the slower overwrite the newer, so two never fly at once; the next waits for the return.
//  · NOTHING LEAVES AFTER UNMOUNT. The timer is cancelled; an in-flight request continues (the draft
//    must arrive even when leaving the page) but its result touches no state.
//
// The save function is a PARAMETER, not an import: the hook knows neither API nor question id, so it
// tests with a fake promise, without module mocks or an HTTP client.
//
// All mutable state lives in ONE box, never touched during render (`react/refs`): every write starts
// from an event (keystroke, timer, request return). The two effects below are the only places updating
// it from the component body.
import { useCallback, useEffect, useRef, useState } from "react";

/** 500 ms, the mockup's compromise: long enough for a sentence typed in one go to be one write, short
 *  enough for the saved message to arrive before doubt sets in. */
export const DRAFT_DEBOUNCE_MS = 500;

export type DraftValues = Record<string, unknown>;

/** Save state. Four states, and `saved` carries ITS TIME: "3 s ago" is computed at render, so no clock
 *  has to refresh the state. */
export type DraftStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

type Saver = (formData: DraftValues) => Promise<unknown>;

export function useInboxDraft(
  save: Saver,
  delay: number = DRAFT_DEBOUNCE_MS,
): {
  status: DraftStatus;
  /** Call on each change. Replaces what has not left yet. */
  schedule: (formData: DraftValues) => void;
  /** Forgets what has not left, called by the final send: `reply` clears the draft server-side, and a
   *  later `PATCH` would bounce with a pointless 409. */
  discard: () => void;
} {
  const [status, setStatus] = useState<DraftStatus>({ kind: "idle" });
  const box = useRef({
    save,
    delay,
    /** What waits its turn. `null` = nothing to send. */
    pending: null as DraftValues | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    inFlight: false,
    alive: true,
  });

  // The caller rebuilds `save` every render (`(fd) => api.saveDraft(id, fd)`): reading it in an effect
  // rather than capturing it avoids resetting the timer on each keystroke, which would defeat the
  // debounce on continuous typing.
  useEffect(() => {
    box.current.save = save;
    box.current.delay = delay;
  }, [save, delay]);

  useEffect(
    () => () => {
      box.current.alive = false;
      clearTimeout(box.current.timer);
    },
    [],
  );

  // A NAMED function: it calls itself again when a change arrived during the flight, which an anonymous
  // arrow could not do before being initialised.
  const flush = useCallback(function flush(): void {
    const b = box.current;
    if (b.inFlight) return; // the in-flight request's return will restart
    const values = b.pending;
    if (values === null) return;
    b.pending = null;
    b.inFlight = true;
    if (b.alive) setStatus({ kind: "saving" });
    void b
      .save(values)
      .then(() => {
        if (box.current.alive) setStatus({ kind: "saved", at: Date.now() });
      })
      // The server message as is: a 409 says the question is no longer open, which is what the page
      // must show, not "failure".
      .catch((err: Error) => {
        if (box.current.alive) setStatus({ kind: "error", message: err.message });
      })
      .finally(() => {
        box.current.inFlight = false;
        // Something arrived during the flight: go again at once, the wait already happened.
        if (box.current.alive && box.current.pending !== null) flush();
      });
  }, []);

  const schedule = useCallback(
    (formData: DraftValues) => {
      const b = box.current;
      b.pending = formData;
      clearTimeout(b.timer);
      b.timer = setTimeout(flush, b.delay);
    },
    [flush],
  );

  const discard = useCallback(() => {
    box.current.pending = null;
    clearTimeout(box.current.timer);
  }, []);

  return { status, schedule, discard };
}
