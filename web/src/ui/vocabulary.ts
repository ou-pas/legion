// The text of the LIBRARY — the vocabulary of the mechanism, not of the domain: close, cancel,
// search, next page. A component in `ui/` knows no Legion object; its sentences name none
// either, so they live here rather than in a domain.
//
// Most of them are DEFAULT prop VALUES (`closeLabel`, `label`): the caller keeps the right to
// name its own button, the catalog only supplies the word when the caller says nothing.
//
// It is called `vocabulary` and not `text` (the convention of the domains) because `ui/text.tsx`
// already exists — it is the typography module (`Text`, `Caption`, `Label`). A `text.ts` placed
// next to it takes the place of `./text.js` at resolution and makes `Text` disappear from the
// whole app: same file name, same imports, no error before compilation.
import { defineText } from "../i18n/catalog.js";
import { combo, ENTER } from "./platform.js";
// Types ONLY (`import type`): `permission-list` imports this catalog back, and a value import
// would create a cycle at load time.
import type { GraphNodeState } from "./graph-layout.js";
import type { PermissionLevel, PermissionScope } from "./permission-list.js";
import { plural } from "./plural.js";

export const UI_TEXT = defineText({
  close: "Close",
  cancel: "Cancel",
  confirm: "Confirm?",
  /** What a screen reader says when a destructive action is armed and the caller gave no
   *  sentence of its own. */
  confirmAnnounce: (label: string) => `${label}: confirm or cancel.`,
  stepDown: (label: string) => `${label}: one step down`,
  stepUp: (label: string) => `${label}: one step up`,
  dismissBanner: "Dismiss this banner",
  dismissToast: "Dismiss notification",
  toastRegion: "Notifications",
  /** The skip link, first focusable of the page. */
  skipToContent: "Skip to content",
  breadcrumb: "Breadcrumb",
  /** The button that unfolds a breadcrumb's collapsed middle levels. */
  breadcrumbMore: (hidden: number) => `Show the ${hidden} hidden levels`,
  mainNav: "Main navigation",
  /** THE COLLAPSE OF THE BAR TOOLS, at the phone breakpoint (14/09). A single word, because it
   *  names a gesture and not a place: what sits behind it — search, concierge, theme,
   *  notifications, version — are tools of the desk, never destinations. */
  topbarMore: "Tools",
  topbarMoreLabel: "Show the bar tools",

  rail: {
    collapse: "Collapse",
    /** Written per platform (13/09): "⌘B" promised a key Windows and Linux lack, while the gesture
     *  always accepted both (use-rail.ts). */
    shortcut: combo("B"),
    reopen: (name: string) => `Open the rail — ${name}`,
  },
  loading: "Loading…",
  search: "Search…",
  clearSearch: "Clear search",
  /** The empty choice of a `Select` — the em dashes frame it, they are not decorative. */
  selectPlaceholder: "— choose —",
  /** The two empties of a `Combobox` say different things: "nothing to offer" is a state of the
   *  source, "nothing matches" a state of what was just typed. Confusing them would suggest an
   *  empty list when three letters just need deleting. */
  combobox: {
    empty: "No value to offer",
    noMatch: "No match",
  },
  /** The accessible name of a sparkline: the curve is an image, its last value is the fact. */
  sparkline: (name: string, last: number) => `${name} — last value ${last}`,
  /** The badge of a required field (`Field required`). */
  required: "required",

  /** The two live moments of `SaveButton`: the spinner's label, and the checkmark's. */
  saveButton: {
    saving: (label: string) => `${label} — saving`,
    saved: (label: string) => `${label} — saved`,
  },

  /** The submit key hint (ui/submit-key.ts) as text rather than key caps.
   *
   *  Since 14/09 the eight submitting buttons compose `Kbd` + `MOD` + `ENTER` through
   *  `ui/submit-shortcut.tsx` instead (D6: a string cannot render two key caps). This entry remains
   *  for the one site with nowhere to put a key cap: the inbox's icon-only button
   *  (`inbox/inbox-reply-field.tsx`), which says it in its Tooltip and `aria-label`.
   *
   *  It used to list both cases, "⌘/Ctrl+↵" (13/09): listing is not informing, the reader has to
   *  sort before acting. */
  submitShortcut: `${combo(ENTER)} to send`,

  /** The unfolding of the raw message of an error: the same action both ways. */
  errorDetail: { expand: "Show all", collapse: "Show less" },

  /** A dropped file: the wait, then the removal. */
  dropzone: {
    busy: "Dropping…",
    removeFile: (name: string) => `Remove ${name}`,
  },

  pagination: {
    label: "Pagination",
    previous: "Previous page",
    next: "Next page",
    page: (n: number) => `Page ${n}`,
    perPage: "Per page",
  },

  /** Acknowledgement of a panel following the flow: "3 messages below". The noun comes from the
   *  caller (message, event…), the template stays here. */
  scroll: {
    /** The noun is given in the SINGULAR and agreed here: the pill counts, and it used to be
     *  handed a plural word ("events") that stayed plural at one. */
    defaultNoun: "item",
    unseenBelow: (count: number, noun: string) => `${count} ${plural(count, noun)} below`,
  },

  /** The toast stack keeps three visible; the rest are counted. */
  toast: {
    pending: (count: number) => `+${count} ${plural(count, "notification")} waiting`,
  },

  /** The two themes: a name, and the palette it carries. */
  theme: {
    light: { label: "Light", hint: "Workshop — warm paper, vermilion" },
    dark: { label: "Dark", hint: "Nord — polar night, frost, aurora" },
  },

  /** Accessible name of a DAG step: "Billing — senior-dev — doing".
   *  Accepted debt: these are a goal's states, so domain, inside a component that should know
   *  nothing about it. Moving `Graph` to the goals domain is separate work. */
  graph: {
    node: (label: string, agent: string, state: string) => `${label} — ${agent} — ${state}`,
    noAgent: "no agent",
    state: {
      todo: "todo",
      doing: "doing",
      review: "review",
      done: "done",
      blocked: "blocked",
    } satisfies Record<GraphNodeState, string>,
  },

  /** A list of grants: the name of a scope and the level granted. */
  permission: {
    scope: {
      repos: "Repos",
      folders: "Folders",
      mcp: "MCP servers",
      network: "Network",
      skills: "Skills",
      rules: "Rules",
      secrets: "Secrets",
      tools: "Tools",
    } satisfies Record<PermissionScope, string>,
    level: {
      rw: "read and write",
      r: "read only",
      none: "no access",
    } satisfies Record<PermissionLevel, string>,
  },
});
