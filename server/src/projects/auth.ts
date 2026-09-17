// Claude authentication, resolved per project with the control plane environment as fallback.
// Like model routing, the most specific wins.
//
// The credential is not subject to the agent's grants (`envSecretNames`): it is not a business
// secret the agent handles, it is what lets the session exist at all.
//
// Since v64 a project carries an ordered list of subscription tokens (`credentials/index.ts`),
// read before its secrets. This file only reads; the decision is in `credential-resolution.ts`,
// which touches neither the database nor the environment.
import { decryptSecret } from "../shared/crypto.js";
import { logControlEvent } from "../events/control-log-store.js";
import { credentialSecretRows } from "./auth-store.js";
import { CREDENTIAL_NAMES, resolveCredential } from "./credential-resolution.js";
import type { CredentialName, CredentialResolution } from "./credential-resolution.js";
import { listCredentials } from "./credentials/index.js";

/** An unreadable secret (missing master key, corrupt content) is skipped rather than fatal: the
 *  session falls back to the environment, or to mock, instead of failing the whole project. */
function credentialSecrets(
  projectId: string,
): { name: string; label: string | null; value: string }[] {
  const rows = credentialSecretRows(projectId, CREDENTIAL_NAMES);
  const out: { name: string; label: string | null; value: string }[] = [];
  for (const row of rows) {
    try {
      out.push({ name: row.name, label: row.label, value: decryptSecret(row.ciphertext) });
    } catch (err) {
      // The label is named here, in the only line there will be about a broken key: it lives in
      // its own column, so it still reads when the value does not.
      //
      // Logged to `control_events` rather than the terminal (batch 4): a changed master key mutes
      // every session of the project, and the diagnosis happens hours later from the Logs screen.
      logControlEvent(
        "error",
        "auth",
        `secret “${row.label ?? row.name}” (${row.name}) of project ${projectId} unreadable: ${(err as Error).message}`,
        { projectId, secret: row.name },
      );
    }
  }
  return out;
}

/** Which account this project spends right now, and whether it is usable. One read for everyone:
 *  the starting session, the control call, the UI, and the decision to resume or sleep after an
 *  out-of-quota stop. */
export function resolveProjectCredential(projectId?: string): CredentialResolution {
  return resolveCredential({
    credentials: projectId ? listCredentials(projectId) : [],
    secrets: projectId ? credentialSecrets(projectId) : [],
    env: process.env,
  });
}

/** Can this project run a real agent? That is the definition of "not mock". Recomputed each time:
 *  a credential added after a goal was created must count.
 *
 *  A project whose tokens are all exhausted stays authenticated: resolution returns the one that
 *  reopens first. Answering `false` would send the next task to mock instead of making it wait. */
export function hasCredential(projectId: string): boolean {
  return Object.keys(resolveProjectCredential(projectId).env).length > 0;
}

/** The environment for an SDK control call (model list, plan usage), with a single credential.
 *
 *  Why not `resolveCredential` (20/08): falling back to the environment, it passes through what is
 *  present as is, deliberately. But a `.env` with both `CLAUDE_CODE_OAUTH_TOKEN` and
 *  `ANTHROPIC_API_KEY` lets the SDK choose, and plan usage only exists for subscription auth. With
 *  the API key visible the SDK answered `rate_limits_available: false` and the gauge stayed empty
 *  with no error.
 *
 *  So the session rule applies: subscription token first, and alone. The others are set to
 *  `undefined` rather than removed, which is how the SDK's `Options.env` says "this variable does
 *  not exist". */
export function soleCredentialEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  const winner = CREDENTIAL_NAMES.find((name) => env[name]);
  if (!winner) return out; // nothing to arbitrate: do not mask what was not chosen
  for (const name of CREDENTIAL_NAMES) if (name !== winner) out[name] = undefined;
  return out;
}

/** The environment for an SDK control call made on behalf of a project.
 *
 *  A call for a project must spend that project's account. Calling with the server's credentials
 *  would give a correct answer about the wrong account, which is worse than no answer.
 *
 *  Same priority as a session: the project's secret first (and alone), then the control plane
 *  environment. `from` says which one served, so a caller showing a result can name the account. */
export function credentialEnvFor(projectId?: string): {
  env: Record<string, string | undefined>;
  from: "project" | "control-plane" | "none";
  /** Which name won, not its value: both open a session, only the name says which one pays. Its
   *  only reader, plan measurement, was removed on 30/08; resolution still returns it because it
   *  alone knows who won. */
  credentialName: CredentialName | null;
  /** The winning key's label when it has one (v48). `null` for an unnamed key and for the control
   *  plane. "The project's credential" names nothing once two projects each carry one. */
  credentialLabel: string | null;
} {
  const { env: pairs, from, credentialName, credentialLabel } = resolveProjectCredential(projectId);
  if (from !== "project")
    return { env: soleCredentialEnv(), from, credentialName, credentialLabel };
  // The project wins alone: other names are masked, or the SDK would arbitrate and the measured
  // account would depend on its read order.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const n of CREDENTIAL_NAMES) env[n] = undefined;
  Object.assign(env, pairs);
  return { env, from, credentialName, credentialLabel };
}
