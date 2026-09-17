// The SDK prompt as a stream rather than a string.
//
// `query({ prompt })` accepts a string (one question, one answer, done) or an async iterable of user
// messages. The latter is the only way to tell an agent something while it works, without stopping
// or relaunching it: the inbox answer pipe, generalised.
//
// The trap: with a string the SDK stops when the agent is done; with a stream it waits for the next
// message until the iterable ends, so a stream nobody closes is a container that never dies. Closing
// is explicit (`close()`, triggered by the `result` event), and the iterator drains its queue before
// ending, so a message pushed at the last millisecond is not dropped.
//
// Pure logic (a queue, a wake-up, a stop condition), testable without SDK or container: see
// server/src/sessions/steer-stream.test.ts.

/**
 * A user message in the SDK's format.
 *
 * `origin: { kind: "human" }` is not decorative: the SDK treats a missing origin as unattributed.
 * These messages come from a human typing; saying so keeps them from passing for anonymous injection.
 */
export type UserMessage = {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  origin: { kind: "human" };
};

export function userMessage(text: string): UserMessage {
  return {
    type: "user",
    message: { role: "user", content: String(text) },
    parent_tool_use_id: null,
    origin: { kind: "human" },
  };
}

/**
 * User message queue exposed as an async iterable.
 *
 * - `push(text)` adds a user turn; returns `false` if the stream is already closed (the message
 *   is then lost for the agent, and the caller must say so, never swallow it).
 * - `close()` ends the stream after draining the queue.
 * - a single consumer: the SDK's `query()`.
 */
export function createInputStream(firstText?: string | null) {
  const queue: UserMessage[] = [];
  let closed = false;
  let wake: ((value: void) => void) | null = null;

  const bump = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };

  if (firstText !== undefined && firstText !== null) queue.push(userMessage(firstText));

  async function* iterate() {
    for (;;) {
      // Drain before checking `closed`: otherwise a message pushed just before closing (an
      // injection arriving during the last turn) would vanish. `shift()` returns `undefined`
      // exactly when the queue is empty, so the loop condition is the message itself; a
      // `while (queue.length)` would ask the type checker to trust that `shift()` returns
      // something.
      for (let m = queue.shift(); m !== undefined; m = queue.shift()) yield m;
      if (closed) return;
      await new Promise((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    push(text: string) {
      if (closed) return false;
      queue.push(userMessage(text));
      bump();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      bump();
    },
    get isClosed() {
      return closed;
    },
    get pending() {
      return queue.length;
    },
    [Symbol.asyncIterator]: iterate,
  };
}
