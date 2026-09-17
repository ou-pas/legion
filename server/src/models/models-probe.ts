// Validate a pinned model when it is saved, not only when the next session starts (operator's
// request, 23/08).
//
// A probe, not a block: an id that `listModels()` ignores can still work in a session;
// `claude-opus-4-8`, tested on 23/08, is announced by no `supportedModels()`. The only refusal that
// counts is the session init's, which names its error. This probe only brings that news forward.
//
//   "listed"       : the id (or the alias it resolves) is in the `listModels()` cache, no network.
//   "exists"       : not listed, but GET /v1/models/{id} → 200. Needs an API key.
//   "unknown"      : the API says 404. A warning, never blocking; `detail` carries its message.
//   "unverifiable" : no API key (OAuth subscription only, or no credential), or the call failed or
//                    timed out. We do not know, so we do not block.
//
// Never probe with an OAuth token: the subscription does not open this endpoint. `credentialEnvFor`
// already lets a single credential win (project first, then control plane); only an API key counts.
import { credentialEnvFor } from "../projects/auth.js";
import { listModels } from "./models.js";

export type ProbeVerdict = "listed" | "exists" | "unknown" | "unverifiable";

export interface ProbeResult {
  verdict: ProbeVerdict;
  detail?: string;
}

const TTL_MS = 6 * 60 * 60 * 1000; // same horizon as listModels()
const DEFAULT_TIMEOUT_MS = 3000;

const cache = new Map<string, { at: number; result: ProbeResult }>();

export function isListed(
  id: string,
  models: readonly { id: string; resolves: string | null }[],
): boolean {
  return models.some((m) => m.id === id || m.resolves === id);
}

/** Injectable so `probeModel` is tested without the SDK, a database or the network. Defaults are
 *  the real implementations. */
export interface ProbeDeps {
  listModels: () => Promise<{ models: readonly { id: string; resolves: string | null }[] }>;
  credentialEnvFor: (projectId?: string) => { env: Record<string, string | undefined> };
  fetch: typeof fetch;
  timeoutMs: number;
}

const defaultDeps: ProbeDeps = {
  listModels,
  credentialEnvFor,
  fetch,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

async function fetchExists(id: string, apiKey: string, deps: ProbeDeps): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: controller.signal,
    });
    if (res.ok) return { verdict: "exists" };
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      const message = body?.error?.message;
      return {
        verdict: "unknown",
        detail: typeof message === "string" ? message.slice(0, 300) : undefined,
      };
    }
    return { verdict: "unverifiable", detail: `unexpected answer from the API (${res.status})` };
  } catch (err) {
    // Timeout or network down: same verdict, we cannot decide so we do not block.
    const e = err as Error;
    return {
      verdict: "unverifiable",
      detail: e.name === "AbortError" ? `timed out (${deps.timeoutMs / 1000} s)` : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `projectId` picks the key (project secret first, then control plane env, via
 *  `credentialEnvFor`). Cached 6 h per id like `listModels()`: the screen re-probes a pinned id on
 *  every blur, and its verdict does not change from one minute to the next. */
export async function probeModel(
  id: string,
  projectId?: string,
  deps: ProbeDeps = defaultDeps,
): Promise<ProbeResult> {
  const trimmed = id.trim();
  if (!trimmed) return { verdict: "unverifiable", detail: "empty id" };

  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

  const remember = (result: ProbeResult): ProbeResult => {
    cache.set(trimmed, { at: Date.now(), result });
    return result;
  };

  const { models } = await deps.listModels();
  if (isListed(trimmed, models)) return remember({ verdict: "listed" });

  const { env } = deps.credentialEnvFor(projectId);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return remember({
      verdict: "unverifiable",
      detail: "no API key available (an OAuth subscription does not open this check)",
    });

  return remember(await fetchExists(trimmed, apiKey, deps));
}

/** For tests and hot restart. */
export function clearProbeCache(): void {
  cache.clear();
}
