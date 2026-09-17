// A project's secrets, the domain side (06/09): add, label, remove. The rule that re-posting a name
// replaces rather than adds used to live in a handler, while `secrets.test.ts` targeted a module that
// did not exist yet.
//
// A secret's value never leaves: encrypted on the way in, never read back here.
import { nanoid } from "nanoid";
import { encryptSecret, hasMasterKey } from "../shared/crypto.js";
import {
  deleteSecretRow,
  replaceSecret,
  secretRowById,
  secretRowsByName,
  updateSecretLabel,
} from "./secrets-store.js";
import type { SecretCreateInput } from "./schemas.js";

/** An empty label clears rather than storing "": "never named" and "named then cleared" must be the
 *  same state. NULL is the only "no label". */
export const cleanLabel = (label: string | null | undefined): string | null =>
  label?.trim() || null;

export type SecretPut = { ok: true; replaced: boolean } | { ok: false; status: 400; error: string };

/** Replace, not add: with no uniqueness constraint on (project, name), re-posting a name created a
 *  second row and resolution picked one at random. Renewing a key is the normal act and must not
 *  leave the old value behind. Delete and insert travel together: a failure between them would erase
 *  the key without replacing it. */
export function putSecret(
  input: SecretCreateInput & {
    /** The refresh token in clear: `putSecret` encrypts it like `value`. */
    refreshToken?: string | null;
    /** What is known about the credential without opening it. Never encrypted, so never a secret. */
    metadata?: Record<string, unknown> | null;
  },
): SecretPut {
  if (!hasMasterKey())
    return { ok: false, status: 400, error: "LEGION_MASTER_KEY missing from server/.env" };
  const name = input.name.trim();
  if (!input.projectId || !name || !input.value)
    return { ok: false, status: 400, error: "projectId, name, value required" };
  const ciphertext = encryptSecret(input.value);
  const previous = secretRowsByName(input.projectId, name);
  replaceSecret(
    previous.map((row) => row.id),
    {
      id: nanoid(10),
      projectId: input.projectId,
      name,
      label: cleanLabel(input.label),
      ciphertext,
      refreshCiphertext: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date(),
    },
  );
  return { ok: true, replaced: previous.length > 0 };
}

/** Relabel a key without re-posting it; fixing a typo should not require pasting the whole token
 *  again. `false` means not found. */
export function setSecretLabel(secretId: string, label: string | null | undefined): boolean {
  const row = secretRowById(secretId);
  if (!row) return false;
  updateSecretLabel(row.id, cleanLabel(label));
  return true;
}

/** Forget the secret of a given name, and report whether something was removed.
 *
 *  By name, not id, because that is all a provider knows: its descriptor declares a `secretName`.
 *  `deleteSecret` stays the Secrets card action, where the operator points at a visible row.
 *
 *  All rows of that name, as `putSecret` replaces them all: nothing enforces (project, name)
 *  uniqueness, and removing only one would leave a duplicate that resolution would still read.
 *
 *  `false` means there was nothing, which is not an error: forgetting twice is the same state as
 *  forgetting once, which makes the act replayable. */
export function forgetSecretNamed(projectId: string, name: string): boolean {
  const rows = secretRowsByName(projectId, name);
  for (const row of rows) deleteSecretRow(row.id);
  return rows.length > 0;
}

/** A secret still cited by an agent (`envSecretNames`) or an MCP header is deleted anyway: it is an
 *  operator act. The session will report it unresolved rather than keep a value meant to be gone.
 *  `false` means not found. */
export function deleteSecret(secretId: string): boolean {
  const row = secretRowById(secretId);
  if (!row) return false;
  deleteSecretRow(row.id);
  return true;
}
