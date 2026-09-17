// The text of the MCP SERVERS registry: the list, and the form that declares one.
//
// What is NOT copy stays in the component: the secret reference (`${SECRET:NAME}`), the JSON
// headers example and the transport names (http, sse, stdio) are code quoted on screen, not
// sentences to translate.
import { defineText } from "../../i18n/catalog.js";
import { UI_TEXT } from "../../ui/vocabulary.js";
import { plural } from "../../ui/plural.js";

export const MCP_TEXT = defineText({
  title: UI_TEXT.permission.scope.mcp,

  /** The description wraps the secret reference, quoted in `code` by the component. */
  descBeforeRef: "A project secret is referenced with",
  descAfterRef:
    "inside a header value — resolved at launch, never stored in clear on the UI side. On a restricted network, the URL's host is allowed on the proxy automatically; add any extra hosts here.",

  emptyTitle: "No MCP server on this project",
  emptyBody:
    "An MCP server gives an agent external tools (Linear, Postgres…) — declare one below, then grant it agent by agent on the Agents page.",
  listLabel: "Project MCP servers",
  hostCount: (n: number) => `${n} ${plural(n, "host")}`,
  /** Same wording as on a rule: it is the same checkbox, at the same place in the row — and it
   *  writes a column of the CURRENT PROJECT, which "all agents" did not say. */
  allAgents: "default for this project",
  delete: "Delete the server (also removes the agents' grants)",
  invalidHeaders: "Headers: invalid JSON — fix the syntax before adding the server.",

  form: {
    label: "Add a server",
    nameLabel: "Name",
    namePlaceholder: "e.g. linear",
    transportLabel: "Transport",
    hostsLabel: "Extra proxy hosts",
    hostsHint: "Comma-separated — on a restricted network.",
    hostsPlaceholder: "a.com,b.com",
    commandLabel: "Command",
    commandHint: "Run inside the session container.",
    commandPlaceholder: "e.g. npx -y @acme/mcp",
    urlLabel: "URL",
    urlPlaceholder: "https://…",
    headersLabel: "JSON headers",
    headersHintBeforeRef: "Quote a project secret with",
    headersHintAfterRef: ": the value is never read or displayed by the UI.",
    submit: "Add the server",
  },
});
