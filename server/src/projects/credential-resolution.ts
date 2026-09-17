// Resolving a Claude credential: which account this session will spend, and is it usable now.
//
// No database, no environment: this is what gets tested. Reads live in `auth.ts` (secrets, control
// plane environment) and `credentials/index.ts` (ordered list, exhaustion); this file only decides.
//
// It depends on nothing else in the domain, for the same reason as `migrations/step.ts`: resolution
// and the store both need these types, and borrowing them from each other would make a cycle.

/** Preference order of variable names when several are set in the same place. Subscription token
 *  first: it is the operator's auth mode, and an API key placed where the SDK expects an OAuth token
 *  is rejected (see shared/env.ts). */
export const CREDENTIAL_NAMES = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

/** The only name that takes a rank (decision of 08/09): the ordered list holds subscriptions only.
 *  An API key stays a project secret, read after the list and unranked, since it has no quota
 *  window to schedule around. */
export const RANKED_CREDENTIAL_NAME = "CLAUDE_CODE_OAUTH_TOKEN";

export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

/** A ranked project credential (`credentials` table), decrypted. The rank alone decides.
 *
 *  `exhaustedUntil` lives on the row, not in a table of windows. The first version stored
 *  (credential, window) pairs because `five_hour`, `seven_day` and `seven_day_opus` reopen
 *  separately; undone on 08/09 because resolution below skips an exhausted account without looking
 *  at which model the task runs, so the three windows behaved as one `max(until)`. See the schema
 *  for what would bring the granularity back. */
export interface RankedCredential {
  id: string;
  name: CredentialName;
  rank: number;
  label: string | null;
  value: string;
  /** NULL or past means usable. */
  exhaustedUntil: Date | null;
  /** The window that closed the account, to say so. A label, never a decision key. */
  exhaustedWindow: string | null;
}

/** Is this account closed now? `null` means usable. Takes only the deciding column, not a whole
 *  `RankedCredential`: the UI view has no decrypted value yet must ask the same question. One place
 *  decides what "still exhausted" means. */
export function exhaustedUntil(
  c: { exhaustedUntil: Date | null },
  now: number = Date.now(),
): Date | null {
  return c.exhaustedUntil && c.exhaustedUntil.getTime() > now ? c.exhaustedUntil : null;
}

export interface CredentialResolution {
  /** Variables to inject. On the project side, never two credentials together. */
  env: Record<string, string>;
  from: "project" | "control-plane" | "none";
  /** The winning `credentials` row. NULL on a fallback (unranked project key or control plane
   *  environment): neither is schedulable, so neither gets exhausted. */
  credentialId: string | null;
  credentialName: CredentialName | null;
  credentialLabel: string | null;
  /** `false` means every ranked credential is exhausted now. `env` is then the one that reopens
   *  first: resumption restarts on it. */
  available: boolean;
  /** When the first one becomes available again. NULL whenever `available`. */
  retryAt: Date | null;
}

export interface CredentialSources {
  /** The project's ordered list (`credentials` table). */
  credentials?: readonly RankedCredential[];
  /** The project's unranked auth secrets, in practice `ANTHROPIC_API_KEY` (decision of 08/09). */
  secrets?: readonly { name: string; label?: string | null; value: string }[];
  /** The control plane environment. */
  env?: Readonly<Record<string, string | undefined>>;
  now?: number;
}

/** First non-exhausted rank, or the one reopening first if all are: the session sleeps until then,
 *  and on waking this same resolution finds it free, with no second choice to remember. `null` when
 *  the project has no ranked credential. */
function resolveFromRanked(
  ranked: readonly RankedCredential[],
  now: number,
): CredentialResolution | null {
  let soonest: { credential: RankedCredential; until: Date } | null = null;
  for (const c of ranked) {
    const until = exhaustedUntil(c, now);
    if (until === null) return projectHit(c, true, null);
    if (!soonest || until.getTime() < soonest.until.getTime()) soonest = { credential: c, until };
  }
  return soonest ? projectHit(soonest.credential, false, soonest.until) : null;
}

function resolveFromSecrets(
  secrets: readonly { name: string; label?: string | null; value: string }[],
): CredentialResolution | null {
  for (const name of CREDENTIAL_NAMES) {
    const hit = secrets.find((s) => s.name === name && s.value !== "");
    if (hit)
      return {
        env: { [name]: hit.value },
        from: "project",
        credentialId: null,
        credentialName: name,
        credentialLabel: hit.label ?? null,
        available: true,
        retryAt: null,
      };
  }
  return null;
}

/** The last link of the chain: always an answer. */
function resolveFromEnv(env: Readonly<Record<string, string | undefined>>): CredentialResolution {
  const inherited: Record<string, string> = {};
  for (const name of CREDENTIAL_NAMES) if (env[name]) inherited[name] = env[name];
  const winner = CREDENTIAL_NAMES.find((n) => env[n]) ?? null;
  return {
    env: inherited,
    from: winner ? "control-plane" : "none",
    credentialId: null,
    credentialName: winner,
    // No secret row, so no label: it is `server/.env`, and there is only one.
    credentialLabel: null,
    available: true,
    retryAt: null,
  };
}

/** Three sources, in this order, and the first that answers wins alone:
 *
 *   1. the project's ordered list, first non-exhausted rank;
 *   2. the project's unranked auth secrets (the API key);
 *   3. the control plane environment.
 *
 *  Sources are never mixed: a project token plus an API key inherited from the environment would
 *  let the SDK choose, so the spent account would depend on its read order. Falling back to the
 *  environment alone passes through what is present as is (historical behaviour, kept).
 *
 *  All ranks exhausted does not fall back to the API key (decision of 08/09). The list holds only
 *  subscriptions, so there is no unlimited last resort: the session sleeps until the nearest reset.
 *  Switching to pay-per-use because a quota closed would be spending decided by an outage. */
export function resolveCredential(sources: CredentialSources = {}): CredentialResolution {
  const { credentials = [], secrets = [], env = {}, now = Date.now() } = sources;
  const ranked = [...credentials].filter((c) => c.value !== "").sort((a, b) => a.rank - b.rank);
  return resolveFromRanked(ranked, now) ?? resolveFromSecrets(secrets) ?? resolveFromEnv(env);
}

function projectHit(
  c: RankedCredential,
  available: boolean,
  retryAt: Date | null,
): CredentialResolution {
  return {
    env: { [c.name]: c.value },
    from: "project",
    credentialId: c.id,
    credentialName: c.name,
    credentialLabel: c.label,
    available,
    retryAt,
  };
}
