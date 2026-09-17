// How a project's sessions run: the image, the Dockerfile layered on it, and the SSH key.
//
// Image and key path become `docker run` arguments; this module validates what goes into that argv
// (and the size of the pasted Dockerfile; the trust rule on its content lives next to the build).
//
// Pure: no database, disk or docker. Key reading is injected, which makes the one check that really
// matters testable: a passphrase-protected key will never work in a container, and it is better said
// before launch than discovered by an agent as "Enter passphrase for key" in a log it does not read.

/** Accepted image reference shape, deliberately narrower than docker's: refuse what has no use
 *  rather than try to cover everything. */
const IMAGE_RE = /^[a-z0-9][a-z0-9._/-]*(:[\w][\w.-]{0,127})?(@sha256:[a-f0-9]{64})?$/;

/** `null` means acceptable; otherwise the sentence to show. */
export function validateSessionImage(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // empty means the default image, cleared upstream
  if (v.length > 256) return "image reference too long (256 characters maximum).";
  // An argument starting with `-` is read by docker as an option. It is the only injection vector left
  // when going through argv rather than a shell.
  if (v.startsWith("-")) return "an image reference cannot start with “-”.";
  if (/\s/.test(v)) return "an image reference contains no space.";
  if (!IMAGE_RE.test(v))
    return "invalid image reference: expected “name”, “name:tag” or “name@sha256:…”, in lowercase.";
  return null;
}

/** Cap on a pasted Dockerfile (09/09): generous for a thin layer (Kopee.me's is a few lines), low
 *  enough to refuse a whole project copied into a text field instead of versioned. The trust rule
 *  itself (FROM, then RUN/ENV/USER only) lives next to the hash in `infra/images/project.ts`
 *  (`validateProjectDockerfile`); this module judges size only. */
export const SESSION_DOCKERFILE_MAX = 8000;

/** `null` means acceptable; otherwise the sentence to show. */
export function validateSessionDockerfile(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // empty means nothing beyond the declared image
  if (v.length > SESSION_DOCKERFILE_MAX)
    return `dockerfile too long (${SESSION_DOCKERFILE_MAX} characters maximum).`;
  return null;
}

/** `null` means acceptable; otherwise the sentence to show. */
export function validateSshKeyPath(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // empty means no key mounted
  if (v.length > 1024) return "path too long (1024 characters maximum).";
  if (!v.startsWith("/"))
    return "absolute path expected: this is a path ON THE DOCKER HOST, and there is no current directory to resolve it from.";
  // `:` separates the fields of `-v source:target:options`. A path containing one would split the
  // mount elsewhere than intended: refused, not escaped.
  if (v.includes(":"))
    return "a key path cannot contain “:” (it is the separator of a docker mount).";
  if (/[\n\r\0]/.test(v)) return "invalid path (newline or null character).";
  if (v.includes(".."))
    return "invalid path: “..” has no place in an absolute path declared by hand.";
  return null;
}

/** The `known_hosts` next to the key, if any.
 *
 *  By convention rather than a second field: the file wanted is exactly the one `ssh` would read for
 *  this key on the operator's machine.
 *
 *  What it buys: adding a self-hosted GitLab no longer requires rebuilding the image; connecting once
 *  from the machine is enough. Fingerprints baked into the image stay the floor, so github.com works
 *  with nothing.
 *
 *  `null` when missing or unreadable: a bonus, never a requirement. */
export function knownHostsBesideKey(
  keyPath: string,
  exists: (p: string) => boolean,
): string | null {
  const cut = keyPath.lastIndexOf("/");
  // `slice(0, -1)` on a path without a slash would give "id_rs", a folder made up from the file
  // name. An explicit check beats accidental truncation.
  if (cut <= 0) return null;
  const dir = keyPath.slice(0, cut);
  const candidate = `${dir}/known_hosts`;
  return exists(candidate) ? candidate : null;
}

/** What the key file says about itself. None of these answers requires running `ssh-keygen`: a
 *  private key's shape is readable as is. */
export type KeyVerdict = { ok: true } | { ok: false; reason: string };

/** `read` returns the file content, or `null` if missing or unreadable. Both have the same remedy:
 *  the container will not have it. */
export function inspectSshKey(path: string, read: (p: string) => string | null): KeyVerdict {
  const body = read(path);
  if (body === null)
    return {
      ok: false,
      reason: `key not found or unreadable at ${path} (path on the docker host).`,
    };

  if (/^ssh-(rsa|ed25519|dss)\s|^ecdsa-sha2-/m.test(body.trimStart().slice(0, 64)))
    return {
      ok: false,
      reason: `${path} is a PUBLIC key. Give the path of the private key (the file WITHOUT “.pub”).`,
    };

  const begin = /-----BEGIN ([A-Z0-9 ]+?) ?PRIVATE KEY-----/.exec(body);
  if (!begin)
    return {
      ok: false,
      reason: `${path} does not look like a private key (no “BEGIN … PRIVATE KEY” header).`,
    };

  // Legacy PEM: encryption announces itself in clear headers right after BEGIN.
  if (/^Proc-Type:\s*4,ENCRYPTED/m.test(body) || /^DEK-Info:/m.test(body))
    return { ok: false, reason: passphraseReason(path) };

  // OpenSSH: the cipher name is the first field of the binary body, "none" meaning clear. Reading it
  // costs a base64 decode; assuming would cost a session dying at clone.
  if (begin[1] === "OPENSSH") {
    const cipher = opensshCipher(body);
    if (cipher === null) return { ok: false, reason: `${path}: unreadable OpenSSH key body.` };
    if (cipher !== "none") return { ok: false, reason: passphraseReason(path) };
  }
  return { ok: true };
}

function passphraseReason(path: string): string {
  return `${path} is protected by a passphrase: nothing can type it inside a container. Use a DEDICATED key without a passphrase (ideally one deploy key per repository).`;
}

/** The cipher name of an OpenSSH key, or `null` if the body cannot be read.
 *
 *  Format: magic "openssh-key-v1\0", then a length-prefixed string (uint32 big-endian) holding the
 *  cipher name. Nothing further is needed. */
function opensshCipher(pem: string): string | null {
  const b64 = pem
    .split("\n")
    .filter((l) => !l.startsWith("-----") && l.trim().length > 0)
    .join("");
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  const MAGIC = "openssh-key-v1\0";
  if (buf.length < MAGIC.length + 4) return null;
  if (buf.subarray(0, MAGIC.length).toString("binary") !== MAGIC) return null;
  const len = buf.readUInt32BE(MAGIC.length);
  // A cipher name is a few bytes. An absurd length means something else is being read: say so
  // rather than allocate what it asks for.
  if (len === 0 || len > 64 || buf.length < MAGIC.length + 4 + len) return null;
  return buf.subarray(MAGIC.length + 4, MAGIC.length + 4 + len).toString("utf8");
}
