// A project's ranked Claude credentials: add, order, remove, and remember which one is exhausted
// until when.
//
// They used to live in `secrets`, where `putSecret` upserts by name: a second
// `CLAUDE_CODE_OAUTH_TOKEN` erased the first. This module adds exactly two things: a rank and a
// reopening time.
//
// The value never leaves: the list gives a rank, a variable name and a label; resolution
// (auth.ts) alone returns the variable to inject.
import { nanoid } from "nanoid";
import { decryptSecret, encryptSecret, hasMasterKey } from "../../shared/crypto.js";
import { exhaustedUntil, RANKED_CREDENTIAL_NAME } from "../credential-resolution.js";
import type { CredentialName, RankedCredential } from "../credential-resolution.js";
import { cleanLabel } from "../secrets.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  credentialRowById,
  credentialRowsOf,
  deleteCredentialRow,
  insertCredentialRow,
  projectRowExists,
  reorderCredentialRows,
  updateCredentialExhaustion,
  updateCredentialLabel,
} from "./store.js";

/** The ordered list, decrypted: for resolution, never for an HTTP response.
 *
 *  An unreadable credential (missing master key, corrupt ciphertext) is skipped rather than fatal,
 *  as auth secrets always were: the project falls to the next rank instead of starting no session
 *  at all. The label is logged because it lives in its own column and still reads when the value
 *  does not. */
export function listCredentials(projectId: string): RankedCredential[] {
  const out: RankedCredential[] = [];
  for (const row of credentialRowsOf(projectId)) {
    try {
      out.push({
        id: row.id,
        name: row.name as CredentialName,
        rank: row.rank,
        label: row.label,
        value: decryptSecret(row.ciphertext),
        exhaustedUntil: row.exhaustedUntil,
        exhaustedWindow: row.exhaustedWindow,
      });
    } catch (err) {
      logControlEvent(
        "error",
        "auth",
        `credential “${row.label ?? row.name}” (rank ${row.rank}) of project ${projectId} unreadable: ${(err as Error).message}`,
        { projectId, credentialId: row.id },
      );
    }
  }
  return out;
}

/** Written once when a session dies out of quota, read by all others so they do not each rediscover
 *  it at the cost of a container start.
 *
 *  A replacement, not an accumulation: the latest known time is right. Exhaustion is only
 *  discovered by using the account, which only happens when it is free, so two windows cannot be
 *  closed at once (the reasoning that removed the per-window table, see schema.ts). */
export function recordExhaustion(credentialId: string, window: string, until: Date): void {
  updateCredentialExhaustion(credentialId, window, until);
}

export interface CredentialView {
  id: string;
  name: string;
  rank: number;
  label: string | null;
  /** Windows still closed, latest first; empty means usable. An array rather than a nullable pair:
   *  a row carries one closed window today (see `recordExhaustion`), but the UI contract must not
   *  change if per-window granularity returns (see the schema). */
  exhausted: { window: string | null; until: Date }[];
}

/** The list as shown: no master key, no decryption, no value. So "rank 2, Pro, exhausted until
 *  19:12 (5 h)" still shows where the master key is missing, instead of an empty list that looks
 *  like a project without credentials. */
export function credentialsOfProject(projectId: string, now = Date.now()): CredentialView[] {
  return credentialRowsOf(projectId).map((row) => {
    const until = exhaustedUntil(row, now);
    return {
      id: row.id,
      name: row.name,
      rank: row.rank,
      label: row.label,
      exhausted: until ? [{ window: row.exhaustedWindow, until }] : [],
    };
  });
}

export type CredentialPut =
  | { ok: true; id: string; rank: number }
  | { ok: false; status: 400 | 404; error: string };

/** Adds a credential at the last rank. It never takes the place of the account in use: adding a
 *  backup must not move spending unasked. Changing rank is a separate act. */
export function addCredential(input: {
  projectId: string;
  name?: string;
  value: string;
  label?: string | null;
}): CredentialPut {
  if (!hasMasterKey())
    return { ok: false, status: 400, error: "LEGION_MASTER_KEY missing from server/.env" };
  if (!input.projectId || !input.value)
    return { ok: false, status: 400, error: "projectId and value required" };
  if (!projectRowExists(input.projectId))
    return { ok: false, status: 404, error: "project not found" };
  const name = (input.name ?? RANKED_CREDENTIAL_NAME).trim();
  // Only a subscription token takes a rank (decision of 08/09): an API key stays a project secret,
  // read after the list. Refused here rather than accepted and never ranked.
  if (name !== RANKED_CREDENTIAL_NAME)
    return {
      ok: false,
      status: 400,
      error: "only CLAUDE_CODE_OAUTH_TOKEN takes a rank; an API key goes in the project secrets",
    };
  const rank = (credentialRowsOf(input.projectId).at(-1)?.rank ?? 0) + 1;
  const id = nanoid(10);
  insertCredentialRow({
    id,
    projectId: input.projectId,
    name,
    rank,
    ciphertext: encryptSecret(input.value),
    label: cleanLabel(input.label),
    createdAt: new Date(),
  });
  return { ok: true, id, rank };
}

/** Renames the account without re-pasting the token. Two subscriptions share a variable name: the
 *  label is the only word telling them apart on screen. */
export function setCredentialLabel(id: string, label: string | null | undefined): boolean {
  const row = credentialRowById(id);
  if (!row) return false;
  updateCredentialLabel(id, cleanLabel(label));
  return true;
}

/** Moves a credential to a position and renumbers the rest. Ranks stay 1..n with no gap or
 *  duplicate, or the UI would show "1, 2, 4" and nobody would know whether an account vanished. */
export function moveCredential(id: string, rank: number): boolean {
  const row = credentialRowById(id);
  if (!row) return false;
  const others = credentialRowsOf(row.projectId)
    .filter((r) => r.id !== id)
    .map((r) => r.id);
  const at = Math.min(Math.max(Math.trunc(rank), 1), others.length + 1) - 1;
  reorderCredentialRows(row.projectId, [...others.slice(0, at), id, ...others.slice(at)]);
  return true;
}

/** Its exhaustion state goes with the row: there is no child table since the time lives in a
 *  column. */
export function deleteCredential(id: string): boolean {
  const row = credentialRowById(id);
  if (!row) return false;
  deleteCredentialRow(id);
  reorderCredentialRows(
    row.projectId,
    credentialRowsOf(row.projectId).map((r) => r.id),
  );
  return true;
}
