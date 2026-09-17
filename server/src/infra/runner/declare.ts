// Declaring a machine (01/09, multi-machine work, slice 01). Before, the only runner came from
// `seed()` and adding one meant writing to SQLite by hand on a running server.
//
// The new runner is probed immediately and the verdict returns with the creation: a mistyped
// `ssh://` URL must not be discovered at the first session, and `pickRunnerRow` refuses a runner
// that never answered, so without this probe it would sit in an unexplained grey zone for up to
// 30 s.
import { nanoid } from "nanoid";
import { probeAndRecord } from "../probe.js";
import { CONCURRENCY_MAX, CONCURRENCY_MIN } from "./limits.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { done, refuse, type Result } from "../../http/from-result.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { insertRunner, runnerByName } from "../runner-store.js";

/** Refusing what Docker accepts would invent a rule. */
const DOCKER_HOST_SCHEMES = ["ssh:", "tcp:", "unix:", "npipe:", "fd:"];
/** These designate another machine and must name it; `unix://` and friends have no host. */
const NEEDS_HOST = ["ssh:", "tcp:"];

export interface DeclaredRunner {
  id: string;
  name: string;
  dockerHost: string | null;
  callbackUrl: string | null;
  maxConcurrentSessions: number;
  /** Did the daemon answer right at declaration? */
  reachable: boolean;
  /** `null` when it answered. */
  error: string | null;
}

/** Exported: the only non-trivial rule here, tested directly. */
export function normalizeDockerHost(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || String(raw).trim() === "") return done(null);
  const text = String(raw).trim();
  const url = parseUrl(text);
  if (!url)
    return refuse(
      400,
      `Docker host expected: a URL, for example ssh://operator@192.168.1.20 (received “${text}”)`,
    );
  if (!DOCKER_HOST_SCHEMES.includes(url.protocol))
    return refuse(
      400,
      `Docker host expected: a ${DOCKER_HOST_SCHEMES.map((s) => `${s}//`).join(", ")} URL (received “${url.protocol}//”)`,
    );
  if (NEEDS_HOST.includes(url.protocol) && !url.hostname)
    return refuse(
      400,
      `Docker host ${url.protocol}// without a machine: the host name is missing, for example ssh://operator@192.168.1.20`,
    );
  return done(text);
}

/** `new URL` throws; here failure is a value, like every other refusal in the module. */
function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The address this runner's containers call back. Must be reachable FROM THE REMOTE MACHINE (the
 *  control plane's tailnet address, never `localhost`); unverifiable from here, so only the HTTP
 *  URL shape is checked. */
function normalizeCallbackUrl(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || String(raw).trim() === "") return done(null);
  const text = String(raw).trim();
  const url = parseUrl(text);
  if (!url)
    return refuse(
      400,
      `callback address expected: an http(s) URL, for example http://100.64.0.1:8790 (got “${text}”)`,
    );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return refuse(
      400,
      `callback address expected in http:// or https:// (got “${url.protocol}//”)`,
    );
  return done(text);
}

function normalizeConcurrency(raw: unknown): Result<number> {
  if (raw === undefined || raw === null || String(raw).trim() === "") return done(3);
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < CONCURRENCY_MIN || n > CONCURRENCY_MAX)
    return refuse(
      400,
      `cap expected: an integer between ${CONCURRENCY_MIN} and ${CONCURRENCY_MAX}`,
    );
  return done(n);
}

/** Returned rather than thrown since 06/09: the route's `catch` returned 400 for everything,
 *  including a taken name, which is a conflict (409), not a malformed request. */
export async function declareRunner(input: {
  name?: unknown;
  dockerHost?: unknown;
  callbackUrl?: unknown;
  maxConcurrentSessions?: unknown;
}): Promise<Result<DeclaredRunner>> {
  const name = String(input.name ?? "").trim();
  if (!name)
    return refuse(400, "a name is required: it is what an agent names in its runner preference");
  // The name has a UNIQUE constraint; checked first so the screen gets a sentence, not SQLite.
  if (runnerByName(name)) return refuse(409, `a runner is already called “${name}”`);

  const host = normalizeDockerHost(input.dockerHost);
  if (!host.ok) return host;
  const callback = normalizeCallbackUrl(input.callbackUrl);
  if (!callback.ok) return callback;
  const concurrency = normalizeConcurrency(input.maxConcurrentSessions);
  if (!concurrency.ok) return concurrency;
  const dockerHost = host.value;
  const callbackUrl = callback.value;
  const maxConcurrentSessions = concurrency.value;

  const id = nanoid(12);
  // `kind` is not a parameter: a `process` runner lives inside the control plane, it is not declared.
  const row = {
    id,
    name,
    kind: RUNNER_KIND.docker,
    dockerHost,
    callbackUrl,
    maxConcurrentSessions,
  };
  insertRunner(row);

  const verdict = await probeAndRecord({ ...row, lastSeenAt: null });
  logControlEvent(
    verdict.ok ? "info" : "warn",
    "runner",
    `runner “${name}” declared (${dockerHost ?? "local socket"}) — ${verdict.ok ? "it answers" : "it does not answer"}`,
    { runnerId: id, dockerHost, why: verdict.ok ? null : verdict.why },
  );

  return done({
    id,
    name,
    dockerHost,
    callbackUrl,
    maxConcurrentSessions,
    reachable: verdict.ok,
    error: verdict.ok ? null : verdict.why,
  });
}
