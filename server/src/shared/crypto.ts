// Secrets at rest: AES-256-GCM, master key OUTSIDE the DB (env / .env, never committed).
// Stolen legion.db ⇒ ciphertext only. Format: base64(iv[12] | authTag[16] | data).
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function masterKey(): Buffer {
  const raw = process.env.LEGION_MASTER_KEY;
  if (!raw) throw new Error("LEGION_MASTER_KEY missing — generate one with: openssl rand -hex 32");
  // Accept any string ≥ 16 chars; derive a stable 32-byte key.
  if (raw.length < 16) throw new Error("LEGION_MASTER_KEY too short (min 16 characters)");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hasMasterKey(): boolean {
  return Boolean(process.env.LEGION_MASTER_KEY);
}
