// Instance settings: the `settings` key/value table, no project.
//
// A sensitive value (a webhook secret) goes through `getEncryptedSetting`/`setEncryptedSetting`:
// encrypted when the master key exists, plain otherwise, like secrets (an instance without
// LEGION_MASTER_KEY is a dev instance, not one to expose).
import { decryptSecret, encryptSecret, hasMasterKey } from "./crypto.js";
import { getSetting, setSetting } from "./settings-store.js";

// Re-exported: other modules import them from here.
export { getSetting, setSetting };

/** Marks an encrypted value. Without it, an instance that gains a master key after writing plain
 *  values would try to decrypt plain text and fail silently at the worst moment. */
const ENC_PREFIX = "enc:";

export function setEncryptedSetting(key: string, value: string): void {
  setSetting(key, hasMasterKey() ? ENC_PREFIX + encryptSecret(value) : value);
}

export function getEncryptedSetting(key: string): string | null {
  const raw = getSetting(key);
  if (raw === null) return null;
  if (!raw.startsWith(ENC_PREFIX)) return raw; // written without a master key: plain, by design
  return decryptSecret(raw.slice(ENC_PREFIX.length));
}
