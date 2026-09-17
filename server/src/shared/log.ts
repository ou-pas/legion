// The terminal log, and nothing else.
//
// Rule (lot 4): a system fact the operator must reread later on the Log screen (session started,
// runner declared, task requeued, migration run, unreadable secret) goes through
// `logControlEvent` into the database. What the terminal shows now and nobody rereads (boot,
// listen address, dev diagnostics, config warnings) goes here. Never both for one fact.
//
// Writes to the streams rather than `console`, so `no-console` covers all of `server/src`.
// No dependency: pino or winston would be a ninth production dependency for one operator reading
// a terminal.

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured detail attached to the line, like `logControlEvent`'s `payload`. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const DEFAULT_LEVEL = ORDER.indexOf("info");

/** Reread on every line, so a test can set `LEGION_LOG_LEVEL` without reimporting. An unknown
 *  value falls back to `info`: a typo must not silence the log. */
function threshold(): number {
  const wanted = process.env.LEGION_LOG_LEVEL?.trim().toLowerCase();
  const i = wanted ? ORDER.indexOf(wanted as LogLevel) : -1;
  return i === -1 ? DEFAULT_LEVEL : i;
}

/** One line per entry: newlines are flattened and values JSON-encoded, or a multi-line stack
 *  would break `grep`. */
function format(level: LogLevel, source: string, message: string, fields?: LogFields): string {
  const ts = new Date().toISOString();
  if (process.env.LEGION_LOG_FORMAT === "json")
    return JSON.stringify({ ts, level, source, message, ...fields });
  const tail = Object.entries(fields ?? {})
    .map(([k, v]) => ` ${k}=${JSON.stringify(v) ?? "undefined"}`)
    .join("");
  return `${ts} ${level.padEnd(5)} [${source}] ${message.replace(/\s*\n\s*/g, " ")}${tail}`;
}

/** `const log = createLogger("runner")`, then `log.warn("…", { sessionId })`. */
export function createLogger(source: string): Logger {
  const emit = (level: LogLevel) => (message: string, fields?: LogFields) => {
    if (ORDER.indexOf(level) < threshold()) return;
    // warn/error to stderr: what calls for action still shows when stdout is redirected.
    const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
    stream.write(`${format(level, source, message, fields)}\n`);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
