// The text of the "Claude credentials" card: a project's ordered list of subscription tokens,
// what is exhausted, and the account serving right now.
//
// The window vocabulary ("5 h", "week", "week (opus)") is the one from
// docs/wiki/guides/quotas.md — do not reinvent it here.
import { defineText } from "../../i18n/catalog.js";

export const CREDENTIALS_CARD_TEXT = defineText({
  title: "Claude credentials",
  listLabel: "Claude credentials of the project",
  desc: "Order decides: the first usable account serves, alone. An exhausted account reopens at the announced time, and the session falls through to the next one without losing anything.",

  /** No account set: this is not a blank to fill, it is a state that works. */
  emptyBefore: "No credential of its own on this project — it uses the control plane's (",
  emptyAfter: ").",

  /** THE VERDICT, at the top of the card: why the session runs on this account. Total exhaustion
   *  comes first, the most frequent case — it has to jump out. */
  active: {
    unavailable: (at: string) =>
      `Every account of the project is exhausted — sessions sleep until ${at}.`,
    fromProject: (label: string | null, name: string) =>
      label ? `This project spends “${label}”.` : `This project spends its ${name} key.`,
    fromControlPlane:
      "This project has no Claude credential of its own: it spends the control plane's.",
    none: "No Claude credential resolves — sessions of this project will run in mock.",
  },

  /** The state of ONE row in the list. */
  status: {
    active: "active",
    waiting: "waiting",
    exhaustedUntil: (at: string, window: string) => `exhausted until ${at} (${window})`,
  },
  /** The name of the window, never the decision key — see docs/wiki/guides/quotas.md. */
  window: {
    five_hour: "5 h",
    seven_day: "week",
    seven_day_opus: "week (opus)",
  },

  /** Reused by `SecretsCard`, on ITS own list: which stored key serves, which is ignored. A key
   *  that is stored, valid and yet ignored cannot be guessed. */
  serving: "this is the key that serves",
  masked: "stored, but masked by the subscription token",

  rankUp: "Move up one rank",
  rankDown: "Move down one rank",
  remove: "Remove",
  removeConfirm: "Confirm removal",
  labelOf: (name: string) => `Label of account ${name}`,
  labelPlaceholder: "name this account",

  valueLabel: "Token",
  valueHint:
    "A subscription token (CLAUDE_CODE_OAUTH_TOKEN). Sent once, encrypted on arrival, never read back.",
  valuePlaceholder: "paste the token",
  aliasLabel: "Label",
  aliasHint: "Optional — the account name, to tell which is which.",
  aliasPlaceholder: "e.g. Personal",
  save: "Add the account",
  stored: (rank: number) => `account added, rank ${rank}`,
});
