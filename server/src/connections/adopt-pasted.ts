// Adopting tokens already stored: probe the rows the provider never answered for, and write what it
// said. Nothing else.
//
// Why here and not in the script: `server/scripts/` is not linted, formatted, typechecked or tested;
// it is the shell that resolves the database and prints. This file holds the three rules worth
// guarding: a refused token writes nothing, an unreachable provider writes nothing, and a second run
// finds nothing to do.
//
// Not a migration: migrations run at boot, and this depends on the network. An instance booting while
// GitHub is unreachable must not stop for a display enrichment.
import { decryptSecret } from "../shared/crypto.js";
import { putSecret } from "../projects/secrets.js";
import {
  attachSecretMetadata,
  grantedSecretsWithoutProbe,
  secretRowFor,
  secretsNamed,
  secretsWithoutProviderFacts,
} from "./connections-store.js";
import {
  knownProviders,
  PROVIDER,
  TOKEN_ORIGIN,
  type Adopted,
  type AuthFormat,
  type ConnectionProvider,
} from "./providers.js";
import { readCredentialMetadata } from "./schemas.js";

/** The former name of a Linear personal key, read by nobody since the 15/09 break
 *  (`integrations/linear.ts` only knows `LINEAR_TOKEN`). An instance carrying one has a silent Linear. */
export const LEGACY_LINEAR_NAME = "LINEAR_API_KEY";

/** What happened to a row; only one outcome writes.
 *
 *  `adopted`: the provider answered, what it said is stored.
 *  `refused`: it does not recognise the token; final for that token, nothing written.
 *  `unreachable`: transport incident (quota, 5xx, network). Nothing written either, and the difference
 *  matters: it can be replayed tomorrow, a refusal cannot.
 *  `unreadable`: the ciphertext does not decrypt (rotated master key, damaged row). Unrelated to the
 *  provider, and fixed differently: restore the key, do not wait for the network.
 *  `incomplete`: the row lacks what probing needs (for GitLab, which instance). Nobody was asked,
 *  nothing written.
 *  `skipped`: nothing to do, the target already exists.
 *
 *  Merging `refused` and `unreachable` would write "this token is dead" on a good token the day the
 *  provider rate-limits; the whole domain holds that split (`probe`, `viewerWith`, the adoption route).
 *
 *  `incomplete` is the 15/09 lesson: a `GITLAB_TOKEN` stored before the host existed does not say which
 *  instance it belongs to. Probing it against `gitlab.com` is exactly what refused a valid framagit
 *  token with a report blaming the provider. The report must never attribute a refusal to someone
 *  nobody asked. */
export const ADOPT_OUTCOME = {
  adopted: "adopted",
  refused: "refused",
  unreachable: "unreachable",
  unreadable: "unreadable",
  incomplete: "incomplete",
  skipped: "skipped",
} as const;
export const ADOPT_OUTCOMES = [
  ADOPT_OUTCOME.adopted,
  ADOPT_OUTCOME.refused,
  ADOPT_OUTCOME.unreachable,
  ADOPT_OUTCOME.unreadable,
  ADOPT_OUTCOME.incomplete,
  ADOPT_OUTCOME.skipped,
] as const;
export type AdoptOutcome = (typeof ADOPT_OUTCOMES)[number];

/** What a row became, precise enough for the operator to know whether to re-run. `probed` exists only
 *  on adoption. `writtenAs` names the written row when it differs from the one read (only
 *  `LINEAR_API_KEY` adopted as `LINEAR_TOKEN`). */
export type AdoptReport = {
  projectId: string;
  secretName: string;
  outcome: AdoptOutcome;
  probed?: Adopted;
  writtenAs?: string;
  /** What the transport said, on `unreachable` or a write refusal. Never the token. */
  why?: string;
};

/** Decrypt then probe, both under the same guard, also returning the clear value (used by
 *  `adoptLegacyLinear`, which stores it elsewhere).
 *
 *  Decryption is inside: the round 1 fix. Both loops called it outside any `try`, so a rotated master
 *  key or damaged ciphertext threw a raw GCM trace, stopped the loop, and no later row was probed or
 *  reported. Nothing was destroyed, but "one line per secret" broke at the first accident. */
async function probeToken(
  provider: ConnectionProvider,
  ciphertext: string,
  /** What the provider asks for besides the token, as the row carries it; carried, not understood. */
  field: string | undefined,
): Promise<{ probed: Adopted; value: string } | { outcome: AdoptOutcome; why?: string }> {
  let value: string;
  try {
    value = decryptSecret(ciphertext);
  } catch (e) {
    // Not `unreachable`: waiting does not fix a rotated master key. The report must point to
    // `server/.env`, not the network.
    return { outcome: ADOPT_OUTCOME.unreadable, why: String((e as Error)?.message ?? e) };
  }
  try {
    const probed = await provider.adopt?.(value, field);
    return probed ? { probed, value } : { outcome: ADOPT_OUTCOME.refused };
  } catch (e) {
    // The token stays out of this message: probes never copy it, and this report prints to a terminal
    // that often ends up in a clipboard.
    return { outcome: ADOPT_OUTCOME.unreachable, why: String((e as Error)?.message ?? e) };
  }
}

/** Only what the probe observed: the adoption-path twin of `pastedMetadata` (`routes.ts`). `undefined`
 *  vanishes at `JSON.stringify`: "unknown" is omitted, which the UI reads as unknown rather than an
 *  empty list. The descriptor's scopes never enter: nobody granted them to this token.
 *
 *  This writes a new object, and `attachSecretMetadata` replaces the whole column. That coupling bit
 *  (round 1): the `LINEAR_TOKEN` set by data patch p1 carries `authFormat: raw`, inferred from the
 *  original row's name. Adoption then probes it, and if the probe has no opinion on format (which
 *  `Adopted` allows), rewriting would erase it; absent means `bearer`, so `gql` would send
 *  `Bearer <personal key>`, the exact 15/09 bug. It breaks nothing today only because Linear always
 *  returns the field.
 *
 *  So the written format is kept when the probe says nothing, the literal contract: absent
 *  `authFormat` in `Adopted` means "nothing to observe", not "erase". Requiring every `adopt` to declare
 *  a format would contradict that contract.
 *
 *  The rest is not merged, on purpose: an `account` or `scopes` kept from an earlier probe would
 *  survive a probe that no longer knows them, showing a stale fact. Format is a property of the kind of
 *  token and does not change under the row. */
function constated(
  provider: ConnectionProvider,
  probed: Adopted,
  /** The format already written on the row, if any. */
  kept: AuthFormat | undefined,
  /** What the provider asked for, as the row carried it. Kept as is, see below. */
  keptFields: Record<string, string> | undefined,
): Record<string, unknown> {
  return {
    provider: provider.kind,
    origin: TOKEN_ORIGIN.pasted,
    account: probed.account ?? undefined,
    scopes: probed.scopes ?? undefined,
    authFormat: probed.authFormat ?? kept,
    // Fields survive too, for the same reason as `authFormat`: this object replaces the old one.
    // Without this line adoption would erase the host it just probed with, and the next run would
    // report the row `incomplete`. The probe observes nothing about these values; it uses them.
    fields: keptFields,
    // The provider answered, the only field saying so. Without it a row where the probe finds neither
    // account nor scopes (a normal result) stayed eligible forever and came back on every
    // `make adopt-tokens`.
    probedAt: Date.now(),
  };
}

/** The header format already written on a row, or `undefined`. Goes through the domain reader rather
 *  than `JSON.parse`: an unreadable column must return nothing, not throw. */
function keptAuthFormat(metadata: string | null): AuthFormat | undefined {
  return readCredentialMetadata(metadata)?.authFormat;
}

/** What the row says the provider asks for, or nothing.
 *
 *  The environment does not enter here, on purpose. `LEGION_GITLAB_HOST` is the instance default for a
 *  connection being made in front of the operator, in a field showing the value. A stored row never saw
 *  that field; lending it the server's host would silently assume which instance a token belongs to,
 *  the very mistake behind this work. It is fixed by re-pasting through the tile, and the report says so.
 *
 *  The rule is not absolute in the domain: `posedOrProposed` (`routes.ts`) does lend the instance
 *  suggestion to a silent row, for the list. What comes out there is a sentence and a link; here it
 *  would be a call carrying a token, then a write. The output decides. */
function posedFields(metadata: string | null): Record<string, string> | undefined {
  return readCredentialMetadata(metadata)?.fields;
}

/** Pasted provider rows the provider never answered for, probed one by one. A provider that cannot
 *  probe is skipped: there is nothing to observe. */
async function enrichOrphans(): Promise<AdoptReport[]> {
  const reports: AdoptReport[] = [];
  // One query per provider rather than one for all plus a name → provider table: three providers, no
  // cost, and each row's provider is known by construction. The previous version looked it up in a
  // `Map` with a complacent `!` that the AST ratchet (`arch-metrics`, `nonNull`) flagged.
  for (const provider of knownProviders().filter((p) => p.adopt !== undefined))
    for (const row of secretsWithoutProviderFacts([provider.secretName])) {
      const head = { projectId: row.projectId, secretName: row.name };
      const asked = provider.field?.();
      const fields = posedFields(row.metadata);
      const field = asked ? fields?.[asked.name] : undefined;
      // Do not probe what we do not know where to send; the report names what is missing rather than
      // inventing a refusal (a `GITLAB_TOKEN` stored before the host existed).
      if (asked && !field?.trim()) {
        reports.push({ ...head, outcome: ADOPT_OUTCOME.incomplete, why: asked.missing });
        continue;
      }
      const verdict = await probeToken(provider, row.ciphertext, field);
      if (!("probed" in verdict)) {
        reports.push({ ...head, outcome: verdict.outcome, why: verdict.why });
        continue;
      }
      attachSecretMetadata(
        row.id,
        JSON.stringify(constated(provider, verdict.probed, keptAuthFormat(row.metadata), fields)),
      );
      reports.push({ ...head, outcome: ADOPT_OUTCOME.adopted, probed: verdict.probed });
    }
  return reports;
}

/** Granted rows whose provider was never asked about their account (round 6).
 *
 *  Since 16/09 a completed flow asks whose token it is and stores the answer. That catches nothing
 *  already stored: an earlier OAuth connection keeps a connected tile with no account.
 *
 *  Here and not in a boot patch, for the header's reason: it depends on the network. The price is that
 *  the operator runs `make adopt-tokens`, as for pasted tokens.
 *
 *  Written by merge, never replacement. `constated` builds a new object with `origin: pasted`: using it
 *  here would lie about provenance and drop the descriptor scopes, expiry and instance. The existing
 *  `metadata` is kept and the new fact added.
 *
 *  An unreadable row stays intact: `readCredentialMetadata` returns `null`, and what cannot be read is
 *  not replaced. */
async function enrichGranted(): Promise<AdoptReport[]> {
  const reports: AdoptReport[] = [];
  for (const provider of knownProviders().filter((p) => p.adopt !== undefined))
    for (const row of grantedSecretsWithoutProbe([provider.secretName])) {
      const head = { projectId: row.projectId, secretName: row.name };
      const existing = readCredentialMetadata(row.metadata);
      if (!existing) continue;
      const asked = provider.field?.();
      const field = asked ? existing.fields?.[asked.name] : undefined;
      // Same guard as the pasted side: do not probe without knowing where to send.
      if (asked && !field?.trim()) {
        reports.push({ ...head, outcome: ADOPT_OUTCOME.incomplete, why: asked.missing });
        continue;
      }
      const verdict = await probeToken(provider, row.ciphertext, field);
      if (!("probed" in verdict)) {
        reports.push({ ...head, outcome: verdict.outcome, why: verdict.why });
        continue;
      }
      attachSecretMetadata(
        row.id,
        JSON.stringify({
          ...existing,
          account: verdict.probed.account ?? undefined,
          // `probedAt` even without an account: "we asked" is distinct from "we learned", and without
          // it a row whose provider names nobody would come back on every run.
          probedAt: Date.now(),
        }),
      );
      reports.push({ ...head, outcome: ADOPT_OUTCOME.adopted, probed: verdict.probed });
    }
  return reports;
}

/** `LINEAR_API_KEY`, handled apart because it is a different act: not enriching a row but writing a
 *  new one under the name the product now reads.
 *
 *  Only works since the format is remembered: a personal key goes raw, and `LINEAR_TOKEN` used to be
 *  sent as `Bearer` always. Copied before that fix, it would have made a connection that looks alive and
 *  is not.
 *
 *  The old row stays: it may hold the only copy of a key the operator has nowhere else. */
async function adoptLegacyLinear(): Promise<AdoptReport[]> {
  const linear = knownProviders().find((p) => p.kind === PROVIDER.linear);
  if (!linear?.adopt) return [];
  const reports: AdoptReport[] = [];
  for (const row of secretsNamed(LEGACY_LINEAR_NAME)) {
    const head = { projectId: row.projectId, secretName: LEGACY_LINEAR_NAME };
    // Already connected: touch nothing. `putSecret` replaces the target row, so running it would
    // overwrite a token in service with an old key.
    if (secretRowFor(row.projectId, linear.secretName)) {
      reports.push({ ...head, outcome: ADOPT_OUTCOME.skipped, writtenAs: linear.secretName });
      continue;
    }
    // Linear asks for nothing besides the token (its host is a constant): `undefined` is what the
    // descriptor declares.
    const verdict = await probeToken(linear, row.ciphertext, undefined);
    if (!("probed" in verdict)) {
      reports.push({ ...head, outcome: verdict.outcome, why: verdict.why });
      continue;
    }
    const put = putSecret({
      projectId: row.projectId,
      name: linear.secretName,
      // The value comes from the probe, decrypted under guard; decrypting again here would reopen the
      // hole just closed.
      value: verdict.value,
      // A personal key cannot be renewed: no refresh token, and `renewable` will say so.
      refreshToken: null,
      // No format to keep: this writes a row that did not exist (the other case is skipped above).
      // The row read is `LINEAR_API_KEY`, whose `metadata` does not concern this one.
      metadata: constated(linear, verdict.probed, undefined, undefined),
    });
    if (!put.ok) {
      reports.push({ ...head, outcome: ADOPT_OUTCOME.unreachable, why: put.error });
      continue;
    }
    reports.push({
      ...head,
      outcome: ADOPT_OUTCOME.adopted,
      probed: verdict.probed,
      writtenAs: linear.secretName,
    });
  }
  return reports;
}

/** The whole adoption: pasted rows to enrich, granted rows never asked about their account, then the
 *  Linear key. The three are independent.
 *
 *  Replayable safely: the second run finds nothing, since the first set the `metadata` and `probedAt`
 *  that take rows out of their filters, and the row that makes `LINEAR_API_KEY` skip. */
export async function adoptPastedTokens(): Promise<AdoptReport[]> {
  return [...(await enrichOrphans()), ...(await enrichGranted()), ...(await adoptLegacyLinear())];
}
