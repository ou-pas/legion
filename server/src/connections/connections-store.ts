// Queries of the connections domain; decisions live in the neighbouring files.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { TOKEN_ORIGIN } from "./providers.js";

/** A project's secret, still encrypted, with what is known about it. One query for the three
 *  columns, not three snapshots of the same row. */
export function secretRowFor(
  projectId: string,
  name: string,
): { ciphertext: string; refreshCiphertext: string | null; metadata: string | null } | null {
  const row = db
    .select({
      ciphertext: schema.secrets.ciphertext,
      refreshCiphertext: schema.secrets.refreshCiphertext,
      metadata: schema.secrets.metadata,
    })
    .from(schema.secrets)
    .where(and(eq(schema.secrets.projectId, projectId), eq(schema.secrets.name, name)))
    .get();
  return row ?? null;
}

/** Which secret names this project has, what Legion can renew, and what it knows about them without
 *  opening them.
 *
 *  Names, not values: the UI asks "is GitHub connected?", not "with what". No secret value ever
 *  reaches the browser.
 *
 *  `renewable` reads `refresh_ciphertext`, literally "I can renew it". It used to read
 *  `metadata !== null` ("came from a connection"): two distinct questions diverging both ways (a
 *  GitHub connection has no refresh token, a pasted token now carries `metadata`). The other half is
 *  `credentialOrigin`. */
export function connectedSecretNames(
  projectId: string,
): { name: string; renewable: boolean; metadata: string | null; createdAt: Date }[] {
  return db
    .select({
      name: schema.secrets.name,
      refreshCiphertext: schema.secrets.refreshCiphertext,
      metadata: schema.secrets.metadata,
      // Since when this token is there. `putSecret` resets it on every write (it replaces the row),
      // so it dates the current connection, not the first: reconnecting is a new token.
      createdAt: schema.secrets.createdAt,
    })
    .from(schema.secrets)
    .where(eq(schema.secrets.projectId, projectId))
    .all()
    .map((r) => ({
      name: r.name,
      renewable: r.refreshCiphertext !== null,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
}

/** Rows carrying one of these names whose provider never said anything, across all projects.
 *
 *  For the one caller that needs the whole database: adoption (`adopt-pasted.ts`), run by the
 *  operator. Routes always work on one project; this repairs leftovers everywhere.
 *
 *  The criterion is no longer "no `metadata`" (15/09, data patch p1). That held while `metadata` could
 *  only come from a probe or a flow. The `p1-secrets-vers-connexions` patch now writes at boot what is
 *  known offline (provider and origin, never account or scopes), so `metadata IS NOT NULL` says
 *  nothing about the provider, and adoption would have had no work on exactly its target rows.
 *
 *  What adoption looks for is the absence of `probedAt`: the provider never answered. The criterion
 *  was first "neither `account` nor `scopes`", wrong in a real case: a probe finding neither is normal
 *  (Linear always returns `scopes: null`), so the row came back on every run, forever.
 *
 *  Pasted tokens only, as the caller's name says. `constated` writes `origin: pasted` on everything it
 *  touches, so probing a granted row would rewrite its origin into a lie. Absent `origin` does not
 *  pass either: pre-15/09 `metadata`, read as granted by `credentialOrigin`.
 *
 *  The bare `= 'pasted'` is right (rechecked in round 7 against `credentialOrigin`): the rule is
 *  `metadata.origin ?? granted`, so absence never means pasted. Rows with no `metadata` at all enter
 *  through the `isNull` branch, which the rule reads as pasted. The granted filter below carried the
 *  symmetric fault; see its comment.
 *
 *  `json_valid` first: `json_extract` throws on malformed JSON in SQLite, which would fail the whole
 *  query on one damaged row. An unparseable `metadata` stays out of adoption: replacing it would erase
 *  what someone wrote. */
export function secretsWithoutProviderFacts(names: readonly string[]): {
  id: string;
  projectId: string;
  name: string;
  ciphertext: string;
  metadata: string | null;
}[] {
  if (names.length === 0) return [];
  return db
    .select({
      id: schema.secrets.id,
      projectId: schema.secrets.projectId,
      name: schema.secrets.name,
      ciphertext: schema.secrets.ciphertext,
      // Current `metadata` comes back with the row because the following write replaces the whole
      // object (`attachSecretMetadata`); without it the caller could not keep what the probe does not
      // say. See `constated` in `adopt-pasted.ts`.
      metadata: schema.secrets.metadata,
    })
    .from(schema.secrets)
    .where(
      and(
        inArray(schema.secrets.name, [...names]),
        or(
          isNull(schema.secrets.metadata),
          sql`json_valid(${schema.secrets.metadata})
              AND json_extract(${schema.secrets.metadata}, '$.origin') = ${TOKEN_ORIGIN.pasted}
              AND json_extract(${schema.secrets.metadata}, '$.probedAt') IS NULL`,
        ),
      ),
    )
    .all();
}

/** Sets a row's `metadata` and nothing else (value, renewal, date untouched), which keeps adoption
 *  non-destructive: the token stays the one that worked. */
export function attachSecretMetadata(id: string, metadata: string): void {
  db.update(schema.secrets).set({ metadata }).where(eq(schema.secrets.id, id)).run();
}

/** Rows of a given name across all projects, for the same caller and the one case
 *  `secretsWithoutProviderFacts` does not cover: `LINEAR_API_KEY`, a name nobody reads since the 15/09
 *  break. Adoption can move it under `LINEAR_TOKEN`; it does not delete it.
 *
 *  `secretRowsByName` (projects domain) answers the same question for one project; here which
 *  projects are concerned is what is being searched. */
export function secretsNamed(
  name: string,
): { id: string; projectId: string; ciphertext: string }[] {
  return db
    .select({
      id: schema.secrets.id,
      projectId: schema.secrets.projectId,
      ciphertext: schema.secrets.ciphertext,
    })
    .from(schema.secrets)
    .where(eq(schema.secrets.name, name))
    .all();
}

/** Granted rows whose provider was never asked about their account.
 *
 *  Twin of `secretsWithoutProviderFacts` for the other origin (round 6). A pasted token goes through
 *  the probe at acquisition and returns its account; a granted one did not before 16/09, so every
 *  earlier OAuth connection kept `metadata` without `account` and a connected tile showing no account.
 *  Fixing acquisition catches nothing existing; this query finds them.
 *
 *  The criterion is `probedAt`, not `account`: a probe finding no account is normal (Linear returns
 *  `account: null` for an unnamed key), and filtering on missing account would keep those rows
 *  eligible for life.
 *
 *  Absent `origin` counts as granted: the round 7 fix. This clause restates `credentialOrigin`
 *  (`schemas.ts`) in SQL, and the rule is `metadata.origin ?? granted`. Written as a bare
 *  `= 'granted'`, the query was stricter than the rule and excluded exactly the rows this adoption
 *  exists for, those written before `origin` existed. On the operator's database the only row to
 *  adopt was one of them, and the script said "nothing to adopt" while the UI showed "Connected via
 *  OAuth" for the same row.
 *
 *  Touch one, think of the other: every SQL read of `origin` must follow `credentialOrigin`, and there
 *  are two in the domain (this one, and the pasted filter above, whose bare `= 'pasted'` is right).
 *
 *  `json_valid` first, as above: one damaged row would fail the whole query. An unreadable row stays
 *  out of adoption. */
export function grantedSecretsWithoutProbe(names: readonly string[]): {
  id: string;
  projectId: string;
  name: string;
  ciphertext: string;
  metadata: string | null;
}[] {
  if (names.length === 0) return [];
  return db
    .select({
      id: schema.secrets.id,
      projectId: schema.secrets.projectId,
      name: schema.secrets.name,
      ciphertext: schema.secrets.ciphertext,
      metadata: schema.secrets.metadata,
    })
    .from(schema.secrets)
    .where(
      and(
        inArray(schema.secrets.name, [...names]),
        sql`json_valid(${schema.secrets.metadata})
            AND (json_extract(${schema.secrets.metadata}, '$.origin') = ${TOKEN_ORIGIN.granted}
                 OR json_extract(${schema.secrets.metadata}, '$.origin') IS NULL)
            AND json_extract(${schema.secrets.metadata}, '$.probedAt') IS NULL`,
      ),
    )
    .all();
}
