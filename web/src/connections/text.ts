// The text of the CONNECTIONS card: connecting a provider without pasting a token.
import { PROVIDER, TOKEN_ORIGIN, type ProviderKind, type TokenOrigin } from "../api/connections.js";
import { defineText } from "../i18n/catalog.js";
import { CONNECT_STATE, type ConnectState } from "../ui/connect-tile.js";
import { LOCALE } from "../ui/locale.js";

/** THE LABEL AND THE SHAPE OF EACH PROVIDER'S TOKEN — named the way IT names them ("Personal
 *  Access Token" at GitHub and GitLab, "Personal API Key" at Linear), with a placeholder that
 *  shows the SHAPE: `ghp_…` is recognized at a glance, where "paste the token here" does not say
 *  which of the three open tabs is the right one.
 *
 *  OUTSIDE THE CATALOG, because TWO entries read it — the field itself and the label of the
 *  divider that separates it from the button — and an object literal cannot reference itself. */
const PASTE = {
  [PROVIDER.github]: { field: "Personal Access Token", placeholder: "ghp_…" },
  [PROVIDER.gitlab]: { field: "Personal Access Token", placeholder: "glpat_…" },
  [PROVIDER.linear]: { field: "Personal API Key", placeholder: "lin_api_…" },
} satisfies Record<ProviderKind, { field: string; placeholder: string }>;

export const CONNECTIONS_TEXT = defineText({
  title: "Connections",
  /** TWO PATHS, ONE TILE. What matters is not where the token comes from but what it is allowed
   *  to do: an OAuth app leaves a trace the organization admins can see, and that is not always
   *  what you want. */
  description:
    "Connect a provider in one click, or paste a token you already have. Either way Legion files it under the name the rest of the product already reads, so cloning, change requests and webhooks work right away.",
  connect: (provider: string) => `Connect ${provider}`,
  open: (provider: string) => `Open ${provider}`,
  /** THE STATE OF A TILE, IN FULL. A table, with `satisfies`: a fifth state cannot arrive without
   *  its word. The provider name is not in it — it is written one line above, in the same tile,
   *  and repeating it would read as two objects where there is one. */
  state: {
    [CONNECT_STATE.ready]: "Not connected yet",
    [CONNECT_STATE.awaitingCode]: "Waiting — enter the code",
    [CONNECT_STATE.awaitingRedirect]: "Waiting — authorize at the provider",
    [CONNECT_STATE.connected]: "Connected",
  } satisfies Record<ConnectState, string>,
  /** THE STATE AND THE MODE ON THE SAME LINE (round 2) — "Connected · OAuth", "Connected · token".
   *
   *  THE ORIGIN USED TO BE A SENTENCE, AND IT EXPLAINED OAUTH to someone who just wants to connect
   *  their tool: "Token pasted — the provider does not know Legion exists". That is a mechanism,
   *  not a state, and it took a whole line of the tile. The mode fits in one word, it reads at a
   *  glance next to the state, and it says the same fact.
   *
   *  Without an origin (unreadable `metadata`), the state stays plain "Connected": saying nothing
   *  about the origin is not the same as inventing it. */
  connectedWith: (mode: string) => `Connected · ${mode}`,
  /** WHAT LEGION ASKED FOR, AND NOT WHAT IT GOT. The label used to say "Granted scopes": wrong
   *  twice. Wrong on the substance — these values come from the adapter, they are what we ASK for,
   *  and nothing here knows what the provider actually granted. Wrong on the form — "scope" is
   *  OAuth's word, not the word of someone setting up their project. */
  /** TWO LABELS, BECAUSE THE LIST DOES NOT SAY THE SAME THING DEPENDING ON THE ORIGIN. On a granted
   *  token, these are the scopes Legion REQUESTED from the provider — that is what we record, and
   *  the brief says so itself: we observe nothing of what it actually granted. On a pasted token,
   *  these are the ones the probe OBSERVED at the provider, which is more honest. A single word for
   *  both would lie to one of them. */
  scopesGranted: "Access requested",
  scopesPasted: "Access observed",
  /** OAUTH'S WORD TRANSLATED INTO WHAT IT ALLOWS. A `repo` label says nothing to someone who does
   *  not write integrations; "Repositories: read and write" says exactly what Legion will be able
   *  to do. The raw value stays available as a tooltip: that is the one you look for when comparing
   *  with the provider's consent screen.
   *
   *  A scope this table does not know is rendered AS IS. That is the right default: a raw name is
   *  ugly but true, where a catch-all "other access" would hide what was just granted. */
  scopeLabels: {
    // GitHub
    repo: "Repositories: read and write",
    "read:org": "Organizations: read",
    "user:email": "Email addresses: read",
    // GitLab
    api: "API: read and write",
    write_repository: "Repositories: write (git)",
  } as Record<string, string>,
  /** TWO WAITS, TWO SENTENCES. The `device` family asks you to type a code elsewhere; the
   *  `redirect` family asks you to follow a link and let the browser come back. One sentence for
   *  both would lie to one of them. */
  awaitingHint: "Enter this code at the provider, then come back — the page updates itself.",
  awaitingRedirectHint: "Authorize Legion at the provider — you will land back here on your own.",
  denied: "Authorization was denied at the provider.",
  expired: "The code expired before it was used. Start again.",
  failed: "The connection failed",
  /** A TRANSPORT HICCUP, NOT A FAILED FLOW: the server returns `pending` when OUR poll cannot
   *  reach the provider. The flow stays open, so the message says we keep going rather than
   *  announcing a failure that did not happen. */
  transportHiccup: "The server is not answering right now — Legion keeps trying.",
  /** WHERE THE TOKEN COMES FROM — TWO WORDS, not two sentences (round 2). They read right after
   *  the state (`connectedWith`), not on a line of their own.
   *
   *  It says NOTHING about renewal: a GitHub connection can be granted and still not renewable,
   *  and an earlier label confused the two. */
  origin: {
    [TOKEN_ORIGIN.granted]: "OAuth",
    [TOKEN_ORIGIN.pasted]: "token",
  } satisfies Record<TokenOrigin, string>,
  /** HOW THIS TOKEN ARRIVED, on the connected tile (round 3). A short sentence next to an icon,
   *  where the badge at the top only says "Connected". */
  acquired: {
    [TOKEN_ORIGIN.granted]: "Connected through OAuth",
    [TOKEN_ORIGIN.pasted]: "Connected with a Personal Access Token",
  } satisfies Record<TokenOrigin, string>,
  /** THE ACCOUNT, BARE (round 3, operator's call). "Account: ou-pas" labelled a value that is
   *  recognizable on its own, in a tile where nothing else is an identifier. */
  account: (name: string) => name,
  /** WHAT THE PROVIDER ANSWERED WHEN ITS ANSWER IS "NO ACCESS".
   *
   *  IT SURVIVES ALONE (round 2), and its twin is gone. "What this token allows is not known" said
   *  we do not know — which the absence of a list already shows. This one says the opposite, and it
   *  is a fact no other element of the tile carries: the provider spoke, and it granted nothing.
   *  Without it, an empty list does not show at all. */
  scopesNone: "The provider reported no access on this token.",
  renewable: "Legion can renew it when it expires.",
  /** SINCE WHEN, without a time: what matters is placing the gesture, not dating it to the minute.
   *  `toLocaleDateString` renders the date in the BROWSER's timezone, which is the right one —
   *  that is where the operator is, not where the server runs.
   *
   *  THE BARE FORM (round 3, operator's call): "since 16 Sept 2026" instead of "This token since
   *  September 16, 2026". That UNDOES round 1's call, which rested on the date being that of the
   *  current token and not of the first connection (`putSecret` REPLACES the row). The fact has not
   *  changed; what changed is that it does not deserve four words in a tile of thirty. The month is
   *  abbreviated for the same reason. */
  since: (at: number) =>
    `since ${new Date(at).toLocaleDateString(LOCALE, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`,

  /** DISCONNECTING — and the three lines below are one single point: the gesture, what it REALLY
   *  does, and where to do what it does not.
   *
   *  LEGION CANNOT REVOKE (checked in the GitHub docs on 15/09): revoking a token requires
   *  APPLICATION authentication, so a `client_secret`, and Legion ships none — which is what makes
   *  its `client_id` public. Disconnecting FORGETS the token here; it stays valid at the provider.
   *  A button that let you believe otherwise would be a lie about a security gesture, and that is
   *  the kind of lie you only discover after a leak.
   *
   *  THE ADMISSION IS SHOWN PERMANENTLY, not only once the button is armed: a truth that only
   *  arrives after starting a security gesture arrives too late to weigh on the decision to start
   *  it. */
  disconnect: "Disconnect",
  disconnectConfirm: "Forget this token?",
  /** WHAT THE SECOND CLICK DOES, announced to the screen reader when the button arms. It first
   *  carried `disconnectMeans`, that is, the sentence already shown permanently two lines below:
   *  heard twice, it taught nothing about the arming itself. */
  disconnectArmed: (provider: string) =>
    `Confirming removes the ${provider} token from this project. Cancelling leaves it in place.`,
  /** SIX WORDS, AND NO LONGER TWO SENTENCES (round 4). "Legion forgets the token. It stays valid at
   *  X until you revoke it there yourself." explained what the link next to it says by its very
   *  PRESENCE: if "Revoke it at X" exists, then disconnecting does not revoke it. The honesty is in
   *  the link, not in its commentary. */
  disconnectMeans: "Disconnecting does not revoke the token.",
  disconnectRevoke: (provider: string) => `Revoke it at ${provider}`,
  disconnectOk: (provider: string) => `${provider} is disconnected`,

  /** WHAT EACH PROVIDER BRINGS TO THE PROJECT, under its name (round 3). The tile said "GitHub" and
   *  nothing else: a product name does not say what you gain, and the operator discovering the
   *  screen has no reason to guess that connecting GitHub unlocks webhooks. A few words, not a
   *  sentence — it is a subtitle. */
  providerSubtitle: {
    [PROVIDER.github]: "Repositories, pull requests & webhooks",
    [PROVIDER.gitlab]: "GitLab Cloud & self-hosted",
    [PROVIDER.linear]: "Issues, cycles & roadmap",
  } satisfies Record<ProviderKind, string>,

  /** THE SECOND PATH, ALWAYS VISIBLE (round 3): no toggle to discover, a field you fill. The label
   *  names what the provider calls ITS thing ("Personal Access Token" at GitHub and GitLab,
   *  "Personal API Key" at Linear), and the placeholder shows the SHAPE of the token — `ghp_…` is
   *  recognized at a glance, where "paste the token here" does not say which of the three open tabs
   *  is the right one. */
  paste: PASTE,
  pasteSubmit: "Connect this token",
  /** THE DIVIDER BETWEEN THE TWO PATHS (round 5) — "or with …". It says "OR", not "THEN": without
   *  it, the field followed the button like a next step, and the screen suggested you had to do
   *  both. The label names the provider's token, so it comes from here. */
  pasteDivider: (provider: ProviderKind) =>
    `or with a ${(PASTE[provider] ?? PASTE[PROVIDER.github]).field}`,
  /** WHAT YOU READ WHEN THE INSTANCE FIELD IS COLLAPSED (round 5). It is prefilled with the default
   *  instance: someone on it has nothing to do there, and must not think something is being asked
   *  of them. The question is addressed to the others. */
  instanceDivider: "Another instance?",
  pasteOk: (provider: string) => `${provider} is connected`,
  /** The server records no provider: nothing to connect, and that is not a failure. */
  empty: "No provider is declared on this instance.",
  loadFailedTitle: "Could not load the connections",
  loadFailedWhy: "The server did not answer the provider list.",
  retry: "Retry",
});
