// The crate: the `.aos` exchange format (26/08), an opaque file sealed with a passphrase that can
// carry secrets.
//
// One clear header line, then the encrypted body in base64:
//
//   {"aos":1,"kdf":"scrypt","N":131072,"r":8,"p":1,"salt":"…","nonce":"…"}
//   <base64(authTag[16] | ciphertext)>
//
// Why the header is clear: it carries only what re-derives the key (no project name, no counts, no
// date), so a stray `.aos` does not say where it came from. In exchange a future version can say
// "format 2, I only read 1" instead of failing GCM authentication and suggesting a wrong
// passphrase. Two failures with different remedies must not give the same message.
//
// The `scrypt` parameters travel for the same reason: hardening `N` later still opens old crates.
// But they come from outside, so `readParams` refuses anything too expensive before deriving.
// Without it, a hostile three-line `.aos` would ask for 68 GB of RAM and kill the control plane,
// with no passphrase needed.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/** Version of the file format, not of the product. */
export const CRATE_FORMAT = 1;

/** Once opened the file holds clear credentials. Twelve characters is a floor, not advice:
 *  `sealCrate` refuses below it. */
export const PASSPHRASE_MIN = 12;

/** About 128 MB and 1 s per opening, on purpose: it makes a dictionary attack painful on a file
 *  that leaves the machine. */
const DEFAULT_N = 131_072;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
/** Node's default `scrypt` memory cap is 32 MB, far below what `DEFAULT_N` needs. */
const MAXMEM = 384 * 1024 * 1024;
/** Safety caps on parameters read from a file (see the module header). */
const MAX_N = 262_144;
const MAX_R = 16;
const MAX_P = 4;

export interface CrateHeader {
  aos: number;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
}

interface KdfParams {
  N: number;
  r: number;
  p: number;
}

function derive(passphrase: string, salt: Buffer, params: KdfParams): Buffer {
  // NFKC: the same phrase typed on two keyboards must give the same key. A composed and a
  // precomposed accented letter are different bytes, and the crate would be unreadable on the
  // other machine with nothing to explain why.
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_LEN, { ...params, maxmem: MAXMEM });
}

/** `work` exists only for tests: a suite paying a second of `scrypt` per case stops being run. No
 *  route passes it. */
export function sealCrate(payload: unknown, passphrase: string, work = DEFAULT_N): string {
  if (passphrase.length < PASSPHRASE_MIN)
    throw new Error(`passphrase of at least ${PASSPHRASE_MIN} characters`);
  const salt = randomBytes(16);
  const nonce = randomBytes(NONCE_LEN);
  const key = derive(passphrase, salt, { N: work, r: KDF_R, p: KDF_P });
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const header: CrateHeader = {
    aos: CRATE_FORMAT,
    kdf: "scrypt",
    N: work,
    r: KDF_R,
    p: KDF_P,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
  };
  return `${JSON.stringify(header)}\n${Buffer.concat([cipher.getAuthTag(), data]).toString("base64")}\n`;
}

function readHeader(text: string): { header: CrateHeader; body: string } {
  const cut = text.indexOf("\n");
  if (cut < 0) throw new Error("this file is not a Legion crate");
  let header: CrateHeader;
  try {
    header = JSON.parse(text.slice(0, cut)) as CrateHeader;
  } catch {
    throw new Error("this file is not a Legion crate");
  }
  if (!header || typeof header.aos !== "number" || header.kdf !== "scrypt")
    throw new Error("this file is not a Legion crate");
  if (header.aos !== CRATE_FORMAT)
    throw new Error(
      `crate in format ${header.aos} — this version only reads format ${CRATE_FORMAT}`,
    );
  const body = text.slice(cut + 1).trim();
  if (!body) throw new Error("empty crate");
  return { header, body };
}

function readParams(h: CrateHeader): KdfParams {
  const N = Number(h.N),
    r = Number(h.r),
    p = Number(h.p);
  const power = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (
    !power ||
    N > MAX_N ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > MAX_R ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > MAX_P
  )
    throw new Error("derivation parameters out of bounds — crate refused");
  return { N, r, p };
}

/** Throws on an unknown format, hostile parameters, or failed authentication. In the last case the
 *  message does not tell a wrong passphrase from a damaged file, since nothing can tell them apart. */
export function openCrate(text: string, passphrase: string): unknown {
  const { header, body } = readHeader(text);
  const params = readParams(header);
  const salt = Buffer.from(header.salt ?? "", "base64");
  const nonce = Buffer.from(header.nonce ?? "", "base64");
  if (salt.length < 8 || nonce.length !== NONCE_LEN)
    throw new Error("this file is not a Legion crate");
  const buf = Buffer.from(body, "base64");
  if (buf.length <= TAG_LEN) throw new Error("truncated crate");
  const key = derive(passphrase, salt, params);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(buf.subarray(0, TAG_LEN));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(buf.subarray(TAG_LEN)), decipher.final()]);
  } catch {
    throw new Error("wrong passphrase, or damaged file");
  }
  try {
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new Error("crate decrypted but unreadable");
  }
}

/** No time of day: a crate of the same project on the same day overwrites the previous one, on
 *  purpose. */
export function crateFilename(slug: string, at = new Date()): string {
  const d = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  const safe =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return `legion-${safe}-${d}.aos`;
}
