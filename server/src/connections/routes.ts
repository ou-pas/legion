// The HTTP boundary of connections: read the request, call the store and the rules, write the
// response. Nothing is decided here.
//
// The exchange secret never leaves. `start` returns an opaque `flowId`; the secret stays in
// `flows.ts`. That holds for both families (the `device_code` trades for a token, the PKCE
// `code_verifier` voids the redirect guarantee) without this file telling them apart: `start` removes
// the `exchange` field and returns the rest as is.
import type { Hono } from "hono";
import { forgetSecretNamed, putSecret } from "../projects/secrets.js";
import { createLogger } from "../shared/log.js";
import { connectedSecretNames } from "./connections-store.js";
import { claimFlowByState, closeFlow, openFlow, readFlow, type Flow } from "./flows.js";
import {
  ARRIVED_KIND,
  FLOW_KIND,
  FLOW_STATUS,
  knownProviders,
  ProviderRefusal,
  providerFor,
  splitState,
  TOKEN_ORIGIN,
  type Adopted,
  type Completion,
  type ConnectionProvider,
} from "./providers.js";
import {
  AdoptConnectionBody,
  CallbackQuery,
  credentialOrigin,
  type CredentialMetadata,
  PollConnectionBody,
  readCredentialMetadata,
  StartConnectionBody,
} from "./schemas.js";
import "./github-device.js"; // the import registers the adapter; no other effect
import "./gitlab-device.js"; // same
import "./linear-redirect.js"; // same, and the first of the redirect family

// An outgoing call incident, not a control plane decision: nothing here needs to survive in the
// database for the Logs screen, so `createLogger` rather than `logControlEvent` (see `shared/log.ts`).
// The operator sees a `flowId` that does not succeed; the terminal keeps why.
const log = createLogger("connections");

/** The `state` of an authorisation URL, read where it already is.
 *
 *  The route reads it rather than receiving it: the port does not return it separately, since it
 *  belongs to the provider's protocol. But the returning browser carries only it, so the flow must be
 *  findable by it. `state` is a standard parameter (RFC 6749 §4.1.1), so reading it assumes nothing
 *  Linear-specific.
 *
 *  Having the route mint it and add it to the URL was rejected: the `state` must be bound to the
 *  `code_verifier` the adapter keeps, and two halves of one secret minted in two files can drift. */
function stateOf(authorizeUrl: string): string | undefined {
  try {
    return new URL(authorizeUrl).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

/** What the provider asked for, stored under the key it named, or `undefined` when it asks for nothing
 *  or nothing came, so `JSON.stringify` writes no empty bag.
 *
 *  The route does not know what it stores: it reads a name from the descriptor and copies a string,
 *  like `scopes` (comment K) and `revokeUrl`. */
function askedFields(
  provider: ConnectionProvider,
  value: string | undefined,
): Record<string, string> | undefined {
  const asked = provider.field?.();
  const posed = value?.trim();
  return asked && posed ? { [asked.name]: posed } : undefined;
}

/** What the connection already has, or what the tile will suggest, in that order.
 *
 *  Two readers, `unconfigured` and `revokeUrl`, both at list time. A connected credential says which
 *  instance it talks to, so its revocation link goes there. An absent one has nothing to say, and
 *  judging its configuration on emptiness would show "host missing" to someone whose tile will pre-fill
 *  that host. What the operator actually sends is judged again at `start` and `adopt`.
 *
 *  The only place in the domain that lends a host to a silent row, contrary to the rest (`posedFields`
 *  in `adopt-pasted.ts` refuses to). Bounded by what comes out: the list only gets a configuration
 *  sentence and a link carrying no token. Nothing written, no authenticated request; those go through
 *  `start` and `adopt`, which refuse an empty value by name. If another reader plugs in here, reread
 *  this first. */
function posedOrProposed(
  provider: ConnectionProvider,
  metadata: CredentialMetadata | null | undefined,
): string | undefined {
  const asked = provider.field?.();
  if (!asked) return undefined;
  return metadata?.fields?.[asked.name] || asked.suggestion;
}

/** Why this flow cannot open, in one sentence for the operator, or `null` if it can.
 *
 *  C: the configuration refusal comes from the provider, not here. The route used to write it,
 *  asserting a configuration fact it does not own: right while all three providers lacked the same
 *  thing, wrong since Linear also needs the public URL and its refusal carries the redirect URL to copy.
 *  The route passes a sentence on; it writes none.
 *
 *  Two refusals (the round 1 gap). `unconfigured` judges what the provider will use, instance default
 *  included; the second judges what the request brought, like `adopt`'s guard. With an env default
 *  set, a field emptied by hand passed `unconfigured` and the flow opened on the env host (no misdirected
 *  token), but `askedFields` stored nothing: the granted credential no longer said which instance it
 *  talks to, adoption would never pick it up (it has `metadata`), and `revokeUrl` would fall back to a
 *  suggestion that can change. Both acts now refuse an emptied field the same way.
 *
 *  The order matters, and a test holds it ("the real GitLab states both causes"): the second refusal
 *  before `unconfigured` would make the host branches unreachable, including "host and app missing".
 *  Without an instance default, an emptied field gets the provider's sentence; with one, the field's.
 *
 *  Both are judged after the body since 15/09, because the body carries part of the configuration:
 *  the instance to talk to. */
function whyStartIsImpossible(
  provider: ConnectionProvider,
  field: string | undefined,
): string | null {
  const unconfigured = provider.unconfigured(field);
  if (unconfigured) return unconfigured;
  const asked = provider.field?.();
  return asked && !(field ?? "").trim() ? asked.missing : null;
}

/** What the probe learned about the account, and whether it was asked; never an exception.
 *
 *  Two fields, because "we do not know who it is" and "we did not ask" differ, and only the second
 *  justifies asking later. A provider answering without naming anyone (Linear on an unnamed key) was
 *  asked; an unreachable provider was not, and adoption will catch up.
 *
 *  A provider that cannot probe (no `adopt`) counts as not asked, and adoption skips it by the same
 *  filter. */
async function probeAccount(
  provider: ConnectionProvider,
  token: string,
  field: string | undefined,
): Promise<{ account?: string; probedAt?: number }> {
  try {
    const probed = await provider.adopt?.(token, field);
    if (probed === undefined) return {};
    return { account: probed?.account ?? undefined, probedAt: Date.now() };
  } catch {
    return {};
  }
}

/** Stores the token: the conclusion of both families (a device grant done polling, a redirect whose
 *  browser came back). Written once: two copies would have drifted at the first omission, most likely
 *  the `refresh_token`.
 *
 *  `putSecret` encrypts both the value and the refresh token itself, so both are passed in clear. It
 *  is the repository's only secret writer. */
async function storeToken(
  flow: Flow,
  provider: ConnectionProvider,
  result: Completion & { accessToken: string },
) {
  // Whose token it is, asked of the provider (round 5). A pasted token goes through the probe and
  // returns its account; a granted one did not, so `metadata.account` stayed empty and an OAuth
  // connection's tile showed no account.
  //
  // Same probe as pasting (`provider.adopt`), never fatal: a flow that just succeeded must not fail
  // because a convenience call did not answer. Without an answer the field is absent, not invented.
  const asked = await probeAccount(provider, result.accessToken, flow.field);
  return putSecret({
    projectId: flow.projectId,
    name: provider.secretName,
    value: result.accessToken,
    refreshToken: result.refreshToken ?? null,
    // In clear, the column's invariant: where it comes from, what it may do, until when. No secret
    // enters (the refresh token lives encrypted in `refresh_ciphertext`).
    //
    // K: scopes come from the adapter, not from here: this route serves any provider and must neither
    // guess nor duplicate what the descriptor had granted. `expiresAt` likewise; `undefined` vanishes
    // at `JSON.stringify`.
    //
    // Origin is written, no longer inferred from the column's presence: a pasted token now carries
    // `metadata` too.
    metadata: {
      provider: provider.kind,
      origin: TOKEN_ORIGIN.granted,
      scopes: provider.scopes,
      expiresAt: result.expiresAt,
      account: asked.account,
      // We asked: distinct from "we learned" (round 6). Without it adoption (`adopt-pasted.ts`) would
      // pick up every row whose provider names nobody, on every run. Absent when the probe did not
      // answer, so adoption can catch up.
      probedAt: asked.probedAt,
      // What the provider asked for to open this flow (the GitLab instance): from the flow, not the
      // current request, since it is the instance the device grant was opened on.
      fields: askedFields(provider, flow.field),
    },
  });
}

/** What is known about a pasted token, shaped for `metadata`: the twin of `storeToken`.
 *
 *  Only what the probe observed; `undefined` vanishes at `JSON.stringify`, which the UI reads as
 *  unknown rather than an empty list. The descriptor's scopes never enter.
 *
 *  `authFormat` is the 15/09 field: a Linear personal key accepted raw was sent as `Bearer` at every
 *  use for lack of remembering it. The header format is not a secret, just the envelope's shape. */
function pastedMetadata(
  provider: ConnectionProvider,
  probed: Adopted | null,
  field: string | undefined,
) {
  return {
    provider: provider.kind,
    origin: TOKEN_ORIGIN.pasted,
    account: probed?.account ?? undefined,
    scopes: probed?.scopes ?? undefined,
    authFormat: probed?.authFormat,
    // The instance this token belongs to, when the provider asks for one: the one that just answered
    // the probe, an observed fact. Without it nothing in the row would say which instance it talks to.
    fields: askedFields(provider, field),
  };
}

export function registerConnectionRoutes(app: Hono): void {
  // What this project has connected, answering for each credential the two questions that used to be
  // merged: where it comes from (`origin`) and whether Legion can renew it (`renewable`).
  app.get("/api/connections", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const posed = new Map(connectedSecretNames(projectId).map((s) => [s.name, s]));
    return c.json({
      connections: knownProviders().map((p) => {
        const secret = posed.get(p.secretName);
        const metadata = readCredentialMetadata(secret?.metadata ?? null);
        // Origin is read once and used twice: shown, and it picks the revocation page (GitHub and
        // GitLab revoke an OAuth grant and a personal token in different places).
        const origin = secret ? credentialOrigin(metadata) : null;
        // What the provider asks for besides the token, and the value it is judged with.
        const asked = p.field?.();
        const fieldValue = posedOrProposed(p, metadata);
        return {
          provider: p.kind,
          secretName: p.secretName,
          connected: secret !== undefined,
          renewable: secret?.renewable ?? false,
          origin,
          // What the token may do as recorded at acquisition, not the scopes the descriptor asks for:
          // a pasted token knows nothing of our app's scopes, and a fine-grained one publishes none.
          // `null` says unknown; a made-up list would be shown as fact.
          scopes: metadata?.scopes ?? null,
          account: metadata?.account ?? null,
          // Since when, epoch milliseconds: the format the UI phrases by itself, independent of the
          // server's time zone.
          connectedAt: secret ? secret.createdAt.getTime() : null,
          // Why the button would be disabled, stated by the provider (comment C). It is now readable
          // before the click, with pasting still available next to it.
          unconfigured: p.unconfigured(fieldValue),
          // What the tile must ask for besides the token, declared by the provider. `null` for the two
          // that ask for nothing. The UI does not learn what a GitLab host is: it gets a label and a
          // value to pre-fill.
          field: asked ? { label: asked.label, suggestion: fieldValue ?? asked.suggestion } : null,
          // Where the token is revoked for good. Legion can only forget it (see `revokeUrl` in
          // `providers.ts`), so the UI must point the operator to where that act exists. It comes from
          // the provider: a self-hosted GitLab does not revoke on `gitlab.com`, and the page depends on
          // origin.
          //
          // `null` when the origin is unknown (unreadable `metadata`): neither page can be designated,
          // and a random one would send the operator where the token is not listed. The sentence stays.
          revokeUrl: origin ? p.revokeUrl(origin, fieldValue) : null,
        };
      }),
    });
  });

  app.post("/api/connections/:provider/start", async (c) => {
    const provider = providerFor(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const parsed = StartConnectionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);

    const refusal = whyStartIsImpossible(provider, parsed.data.field);
    if (refusal) return c.json({ error: refusal }, 400);

    try {
      const started = await provider.begin({
        projectId: parsed.data.projectId,
        field: parsed.data.field,
      });
      // The return handle for the family that has one: the `state` secret, not the whole `state`. Its
      // prefix will be checked against `flow.provider` rather than used for lookup (see `splitState`).
      const presented =
        started.kind === FLOW_KIND.redirect ? stateOf(started.authorizeUrl) : undefined;
      const state = presented ? splitState(presented).secret : undefined;
      if (started.kind === FLOW_KIND.redirect && !state) {
        // A redirect flow without `state` is a dead end: the callback could not find the flow, and the
        // operator would come back to a "stale link" naming no cause. An adapter fault, hence 502, as
        // for a provider answering "connected" without a token.
        log.warn("a redirect flow started without a state", { provider: provider.kind });
        return c.json({ error: `${provider.kind} opened a flow without a state` }, 502);
      }
      const flowId = openFlow({
        provider: provider.kind,
        projectId: parsed.data.projectId,
        exchange: started.exchange,
        expiresAt: started.expiresAt,
        state,
        // The instance this flow was opened on travels with it: the `device_code` is only exchanged
        // there.
        field: parsed.data.field,
      });
      // The variant as is, minus the secret. The UI reads `kind` to know what to show. Removing
      // `exchange` by destructuring rather than whitelisting keeps this blind to the number of
      // variants, and names the one field that never leaves.
      const { exchange: _exchange, ...variant } = started;
      return c.json({ flowId, ...variant });
    } catch (e) {
      // M: the exception message does not leave. It carried GitHub's internal URL to the browser
      // (`postForm` quotes it), which `http/errors.ts` forbids, and nothing was logged, unlike `poll`.
      // Now aligned: detail to the terminal, an actionable fact to the client.
      log.warn("transport incident while opening an OAuth flow", {
        provider: provider.kind,
        projectId: parsed.data.projectId,
        error: String((e as Error)?.message ?? e),
      });
      return c.json({ error: `${provider.kind} did not answer; try again in a moment.` }, 502);
    }
  });

  app.post("/api/connections/:provider/poll", async (c) => {
    const provider = providerFor(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const parsed = PollConnectionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);

    // An unknown or expired flow is "expired", not an error: what happens after a server restart, and
    // the UI can only offer to start again.
    //
    // A: the owner is an argument of the read. `readFlow` returns a flow only if it belongs to the
    // URL's provider; otherwise a GitHub `flowId` polled on `/gitlab/poll` would send GitHub's
    // `device_code` to GitLab (full reasoning on `readFlow`). In the signature, no future route can
    // forget it. "expired" for all three cases (unknown, expired, not its own): a probing caller
    // learns nothing.
    const flow = readFlow(parsed.data.flowId, provider.kind);
    if (!flow) return c.json({ status: FLOW_STATUS.expired });

    // This route serves only the `device` family: `{ kind: "poll" }` tells the adapter we are asking
    // again. A redirect provider refuses it by name; its half is the callback route below.
    //
    // J: this `try` covers only the network call. It used to cover `putSecret` too: a
    // `LEGION_MASTER_KEY` present but too short (`hasMasterKey()` lets it through, `encryptSecret`
    // refuses it) or any SQLite failure fell into the network `catch` and came out as a silent
    // "pending". An exception outside `provider.complete` is not an outgoing call incident and must
    // reach `app.onError`.
    let result: Completion;
    try {
      result = await provider.complete(flow.exchange, { kind: ARRIVED_KIND.poll }, flow.field);
    } catch (e) {
      if (e instanceof ProviderRefusal) {
        // B: a terminal provider refusal (app not enabled, unknown error code): the flow cannot
        // succeed, so close it and name the refusal.
        closeFlow(parsed.data.flowId);
        return c.json({ error: e.message }, 502);
      }
      // B: everything else is a transport incident (provider 5xx, network), not a refusal: the
      // device_code stays valid about fifteen minutes, so a retry can succeed. The flow stays open and
      // an ordinary "pending" is returned; the UI retries at the next tick.
      //
      // L: this silence is bounded (the flow expires), but a lasting outage becomes indistinguishable
      // from a slow operator and undiagnosable afterwards unless logged. Logged here with `log.warn`:
      // an outgoing call incident, not a fact for the Logs screen.
      log.warn("transport incident during an OAuth retry", {
        provider: provider.kind,
        flowId: parsed.data.flowId,
        error: String((e as Error)?.message ?? e),
      });
      return c.json({ status: FLOW_STATUS.pending });
    }

    if (result.status === FLOW_STATUS.connected) {
      if (!result.accessToken) {
        // E: the provider says "connected" without a token. The type allows it for a future provider;
        // the current adapters never produce it. Not recorded as success: nothing was stored and the
        // flow stays open, so a normal retry can still succeed.
        return c.json(
          { error: `${provider.kind} answered “connected” without an access token` },
          502,
        );
      }

      const put = await storeToken(flow, provider, {
        ...result,
        accessToken: result.accessToken,
      });
      if (!put.ok) {
        // A: nothing was written (`LEGION_MASTER_KEY` missing, for instance). Answering "connected"
        // would lie, and closing the flow would lose the token for good. Name the real cause with
        // `putSecret`'s status and leave the flow open, so a retry after fixing it succeeds without
        // restarting the device flow.
        return c.json({ error: put.error }, put.status);
      }
      closeFlow(parsed.data.flowId);
      return c.json({ status: FLOW_STATUS.connected });
    }

    if (result.status === FLOW_STATUS.denied || result.status === FLOW_STATUS.expired)
      closeFlow(parsed.data.flowId);
    return c.json({ status: result.status });
  });

  // Adopting a pasted token: the second acquisition path, not a replacement for the other.
  //
  // Why it exists: a Linear OAuth app belongs to a workspace and all its admins see it. The operator
  // does not always want that trace in the organisation. The way out is not to give up OAuth but to
  // admit automation depends on what a token can do, not its origin.
  //
  // No configuration check here, unlike `start`: pasting needs no declared app, which is what makes
  // this path useful where the other is closed.
  app.post("/api/connections/:provider/adopt", async (c) => {
    const provider = providerFor(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const parsed = AdoptConnectionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);

    // What the provider asks for besides the token must be present before probing, and the refusal
    // is the provider's (comment C).
    //
    // Not `unconfigured`: pasting needs no app, but it needs to know whom to present the token to.
    // Without this refusal GitLab would probe a host-less URL, the call would throw, and the operator
    // would read "GitLab did not answer; try again": a made-up transport incident over a value they
    // simply did not type, the same kind of lie that made the 15/09 diagnosis so long.
    const asked = provider.field?.();
    if (asked && !(parsed.data.field ?? "").trim()) return c.json({ error: asked.missing }, 400);

    // This `try` covers only the probe, as `poll`'s covers only the network call (comment J): an
    // encryption or database failure must reach `app.onError`, not become "the provider did not answer".
    let probed: Adopted | null = null;
    if (provider.adopt) {
      try {
        probed = await provider.adopt(parsed.data.token, parsed.data.field);
      } catch (e) {
        // The token stays out of this log: who, which project, what the transport said. The probe
        // never copies the token into its messages (see `probe`).
        log.warn("transport incident while adopting a token", {
          provider: provider.kind,
          projectId: parsed.data.projectId,
          error: String((e as Error)?.message ?? e),
        });
        return c.json({ error: `${provider.kind} did not answer; try again in a moment.` }, 502);
      }
      // Refused by the provider means nothing is written: a dead token stored would show "connected"
      // for a credential that does not work, discovered at the first clone.
      if (!probed) return c.json({ error: `${provider.kind} did not recognise this token.` }, 400);
    }

    const put = putSecret({
      projectId: parsed.data.projectId,
      name: provider.secretName,
      value: parsed.data.token,
      // Cannot be renewed, the one real difference with a granted token: no refresh token, so
      // `renewable` stays false and says so.
      refreshToken: null,
      // In clear, and only what the probe observed; see `pastedMetadata`.
      metadata: pastedMetadata(provider, probed, parsed.data.field),
    });
    // Read outside the `try`, as in `poll`: a write refusal (missing master key) is not a provider
    // incident and must name itself.
    if (!put.ok) return c.json({ error: put.error }, put.status);
    // No echo of the token: the response carries only what the UI will read back from the list anyway.
    return c.json({ connected: true });
  });

  // Disconnect, which is not a revocation, and must never look like one.
  //
  // Legion cannot revoke at the provider (checked in GitHub docs on 15/09): `DELETE
  // /applications/{client_id}/token` needs app authentication, so a `client_secret`, and we ship none.
  // This route forgets the row on Legion's side; the token stays valid until the operator revokes it
  // there, and the UI carries the link (`revokeUrl`). A button implying otherwise would lie about a
  // security act.
  //
  // Replayable: nothing to disconnect returns `{ forgotten: false }` and a 200. A 404 would fail the
  // second click of a double click, on exactly the requested state.
  //
  // `projectId` in the query because this DELETE has no body, like `GET /api/connections`.
  //
  // `/token` last names what goes, and keeps `make contract` usable: the UI call reads as
  // `/api/connections/:p`, which has as many segments as `/api/connections/callback` and would cover it,
  // passing off as called a route the UI never calls (the provider returns there).
  app.delete("/api/connections/:provider/token", (c) => {
    const provider = providerFor(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown provider" }, 404);
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    // The secret name comes from the descriptor: guessing would erase the wrong row the day a
    // descriptor changes its name.
    return c.json({ forgotten: forgetSecretNamed(projectId, provider.secretName) });
  });

  // The browser's return: the other half of the redirect family, and the most exposed route of the
  // domain. It is not authenticated by what it carries, and it writes a secret.
  //
  // What guards it and what does not:
  //   · `mutationOriginGuard` does not cover it (POST/PUT/PATCH/DELETE only), and could not: the
  //     browser arrives from `linear.app` with a foreign origin. That is the nature of a callback.
  //   · `operatorGuard` does, deliberately not exempted: the path starts with `/api/` and is not the
  //     login door. The operator cookie is `SameSite=Lax`, so it is sent on a top-level navigation, which
  //     this return is. A third party forging a callback from its own page has no session and is
  //     refused before arriving. The accepted cost: a session expiring during the detour at Linear
  //     gives a 401, and the operator restarts the flow.
  //   · the `state` does the real work: unpredictable (`randomBytes`), bound to one flow so one project,
  //     expiring with it, and single use (`claimFlowByState`).
  //
  // A literal URL, not a constant: `scripts/api-contract.ts` reads literals. Its twin is in
  // `linear-redirect.ts`, and a test links the two.
  app.get("/api/connections/callback", async (c) => {
    // The three parameters picked by name, then validated (see `CallbackQuery`): untrusted input from
    // a browser returning from a third party.
    const parsed = CallbackQuery.safeParse({
      state: c.req.query("state"),
      code: c.req.query("code"),
      error: c.req.query("error"),
    });
    // No redirect on this refusal, the only one: without a readable `state` there is no flow, so no
    // project and no screen to send back to. It is also the case that does not look like an operator.
    //
    // The message names the faulty field, not `state` by default: three causes land here (missing
    // `state`, empty `code`, empty `error`), and saying "callback without state" on an empty `code=`
    // points to the wrong place in a log where the request cannot be replayed.
    if (!parsed.success) {
      const champ = parsed.error.issues[0]?.path.join(".") || "state";
      return c.json({ error: `callback: parameter ${champ} missing or empty` }, 400);
    }

    // Whose return this is. The callback is unique for the whole family (the URL registered at the
    // provider), so the path does not say: the `state` carries its provider as prefix. The prefix
    // designates and proves nothing (the caller writes it like the rest of the query). The proof
    // follows: the flow must exist and be its own.
    const { kind, secret } = splitState(parsed.data.state);
    const provider = providerFor(kind);
    if (!provider) return c.json({ error: "callback without a known provider" }, 400);

    // Consumed here, once. Unknown, expired, already presented, or another provider's: all four return
    // the same thing, so a probing caller learns nothing.
    const flow = claimFlowByState(secret, provider.kind);
    if (!flow)
      return c.json(
        { error: "this connection link has already been used, or it has expired" },
        400,
      );

    // From here we know where to send back, so everything ends with a redirect: an operator must not
    // stay on an API page. The Integrations screen remounts and refetches, so success shows by itself.
    // A relative address: the browser resolves it on the host it came through, avoiding a third
    // setting repeating `LEGION_PUBLIC_URL`.
    const back = `/p/${encodeURIComponent(flow.projectId)}/project/integrations`;

    // A provider refusal (the operator clicked "Deny") is not a failure: the flow is consumed, there is
    // nothing to store, and the UI will still show Linear disconnected.
    if (parsed.data.error || !parsed.data.code) {
      log.warn("connection callback without a code", {
        provider: provider.kind,
        error: parsed.data.error ?? "code missing",
      });
      return c.redirect(back);
    }

    try {
      const result = await provider.complete(
        flow.exchange,
        { kind: ARRIVED_KIND.code, code: parsed.data.code },
        flow.field,
      );
      if (result.status !== FLOW_STATUS.connected || !result.accessToken) {
        log.warn("code exchange returned no token", {
          provider: provider.kind,
          status: result.status,
        });
        return c.redirect(back);
      }
      const put = await storeToken(flow, provider, {
        ...result,
        accessToken: result.accessToken,
      });
      // The log is the only place this refusal shows: the route sends back to a screen and the flow
      // is consumed, so there is no retry. Without this line a missing master key would mean
      // "coming back from Linear with nothing changing", forever and without a trace.
      if (!put.ok) log.warn("token not stored on the provider callback", { error: put.error });
    } catch (e) {
      // Terminal refusal or transport incident, same outcome: the `state` is consumed, so the flow
      // cannot succeed anyway. Detail to the terminal; the operator goes back and clicks again.
      log.warn("code exchange failed", {
        provider: provider.kind,
        error: String((e as Error)?.message ?? e),
      });
    }
    return c.redirect(back);
  });
}
