import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inspectSshKey,
  knownHostsBesideKey,
  SESSION_DOCKERFILE_MAX,
  validateSessionDockerfile,
  validateSessionImage,
  validateSshKeyPath,
} from "./session-runtime.js";

describe("validateSessionImage", () => {
  it("accepts the usual forms", () => {
    for (const v of [
      "legion-session:latest",
      "acme/session",
      "ghcr.io/ou-pas/session:v2",
      "img@sha256:" + "a".repeat(64),
    ])
      assert.equal(validateSessionImage(v), null, v);
  });

  it("empty means the default image, not an error", () => {
    assert.equal(validateSessionImage("   "), null);
  });

  it("refuses what starts with a dash: docker would read it as an option", () => {
    // The only vector surviving argv: `--privileged` passed as an image name.
    assert.match(validateSessionImage("--privileged")!, /“-”/);
  });

  it("refuses a space, which would split the argument", () => {
    assert.match(validateSessionImage("img --privileged")!, /no space/);
  });

  it("refuses uppercase: docker does not accept it in a repository name", () => {
    assert.ok(validateSessionImage("Legion-session:latest"));
  });
});

describe("validateSessionDockerfile", () => {
  it("empty means nothing beyond the declared image, not an error", () => {
    assert.equal(validateSessionDockerfile("   "), null);
  });

  it("accepts a Dockerfile of usual size", () => {
    assert.equal(
      validateSessionDockerfile("FROM legion-session:latest\nRUN apt-get install -y php8.2-cli\n"),
      null,
    );
  });

  it("refuses what exceeds the cap, stating the number", () => {
    assert.match(
      validateSessionDockerfile("x".repeat(SESSION_DOCKERFILE_MAX + 1))!,
      new RegExp(`${SESSION_DOCKERFILE_MAX}`),
    );
  });
});

describe("validateSshKeyPath", () => {
  it("accepts an absolute path", () => {
    assert.equal(validateSshKeyPath("/Users/operateur/.ssh/id_acme"), null);
  });

  it("empty means no key, not an error", () => {
    assert.equal(validateSshKeyPath(""), null);
  });

  it("refuses a relative path, saying why (docker host, no current directory)", () => {
    assert.match(validateSshKeyPath("~/.ssh/id_rsa")!, /absolu/);
  });

  it("refuses the colon: it separates a docker mount's fields", () => {
    // `-v /a:b:/run/…:ro` would split the mount elsewhere than intended.
    assert.match(validateSshKeyPath("/a:b/id")!, /“:”/);
  });

  it("refuses .. in a hand-declared path", () => {
    assert.match(validateSshKeyPath("/home/../etc/shadow")!, /\.\./);
  });
});

// ---- inspectSshKey: the one check that avoids a session dying at clone ----

const OPENSSH_CLAIR = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  // magic "openssh-key-v1\0" + uint32(4) + "none"
  Buffer.concat([
    Buffer.from("openssh-key-v1\0", "binary"),
    Buffer.from([0, 0, 0, 4]),
    Buffer.from("none"),
    Buffer.alloc(32),
  ]).toString("base64"),
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

const OPENSSH_CHIFFREE = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  Buffer.concat([
    Buffer.from("openssh-key-v1\0", "binary"),
    Buffer.from([0, 0, 0, 20]),
    Buffer.from("aes256-ctr\0\0\0\0\0\0\0\0\0\0"),
    Buffer.alloc(32),
  ]).toString("base64"),
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

const PEM_CHIFFREE = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "Proc-Type: 4,ENCRYPTED",
  "DEK-Info: AES-128-CBC,0123456789ABCDEF",
  "",
  "AAAA",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

const only = (content: string | null) => () => content;

describe("inspectSshKey", () => {
  it("accepts a clear OpenSSH key", () => {
    assert.deepEqual(inspectSshKey("/k", only(OPENSSH_CLAIR)), { ok: true });
  });

  it("refuses a passphrase OpenSSH key: nothing can type it in a container", () => {
    const v = inspectSshKey("/k", only(OPENSSH_CHIFFREE));
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /passphrase/);
  });

  it("also refuses the legacy encrypted PEM form, announced in a header", () => {
    const v = inspectSshKey("/k", only(PEM_CHIFFREE));
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /passphrase/);
  });

  it("recognises a public key and asks for the other file", () => {
    const v = inspectSshKey("/k.pub", only("ssh-ed25519 AAAAC3Nza operator@mac\n"));
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /PUBLIC/);
  });

  it("an unreadable or missing file is a named blocker, not silence", () => {
    const v = inspectSshKey("/absent", only(null));
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /not found or unreadable/);
  });

  it("a file that is not a key says so without guessing", () => {
    const v = inspectSshKey("/k", only("bonjour"));
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /private key/);
  });

  it("an unencrypted PEM key passes (no Proc-Type)", () => {
    assert.deepEqual(
      inspectSshKey(
        "/k",
        only("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"),
      ),
      { ok: true },
    );
  });
});

// ---- knownHostsBesideKey: the convention that avoids a second field ----

describe("knownHostsBesideKey", () => {
  it("finds known_hosts in the same folder: the one ssh would read on the machine", () => {
    assert.equal(
      knownHostsBesideKey(
        "/Users/operateur/.ssh/id_acme",
        (p) => p === "/Users/operateur/.ssh/known_hosts",
      ),
      "/Users/operateur/.ssh/known_hosts",
    );
  });

  it("returns null when there is none: a bonus, never a requirement", () => {
    assert.equal(
      knownHostsBesideKey("/Users/operateur/.ssh/id_acme", () => false),
      null,
    );
  });

  it("does not look outside the key's folder", () => {
    // A key stored elsewhere must not pick up ~/.ssh's known_hosts: the wanted file is the one next
    // to this key, not the first found.
    const seen: string[] = [];
    knownHostsBesideKey("/opt/keys/deploy", (p) => {
      seen.push(p);
      return false;
    });
    assert.deepEqual(seen, ["/opt/keys/known_hosts"]);
  });

  it("a path without a folder looks for nothing", () => {
    assert.equal(
      knownHostsBesideKey("id_rsa", () => true),
      null,
    );
  });
});
