// Text catalog of the portability domain — a project's encrypted crate.
import { defineText } from "../i18n/catalog.js";
import type { CratePart } from "../api/portability.js";
import { plural } from "../ui/plural.js";

/** The label of each part, and its unit. The count comes from the server, never from here. */
export const CRATE_PART_LABEL: Record<CratePart, string> = {
  agents: "Agents, their capabilities and their access",
  repos: "Declared repositories",
  mcpServers: "Tool servers",
  rules: "Rules",
  templates: "Templates and chains",
  secrets: "Secrets and variables",
};

export const CRATE_TEXT = defineText({
  tab: "Crate",
  export: {
    title: "Export the configuration",
    desc: "A file encrypted with a passphrase only you know. It holds enough to recreate this project on another machine, and says nothing to whoever finds it.",
    project: "Project",
    contents: "What goes into the crate",
    empty: "Nothing checked: the crate would be empty.",
    total: (n: number) => `${n} ${plural(n, "item")} in total`,
    withSecrets: (n: number) => `${n} ${plural(n, "secret")} included`,
    withoutSecrets: "without the secrets",
    secretsWarn: (n: number) =>
      `${n} ${plural(n, "secret")} will be decrypted from this machine's master key, then re-encrypted under your passphrase. Losing the passphrase means losing the file: nothing reopens it.`,
    passphrase: "Passphrase",
    passphraseHint: "It does not leave this machine and is written nowhere.",
    tooShort: (len: number, min: number) =>
      `Too short: ${len} ${plural(len, "character")} out of ${min} expected.`,
    repeat: "Repeat the passphrase",
    mismatch: "The two entries differ.",
    filename: "File name",
    submit: "Export the crate",
    working: "Encrypting…",
    done: (name: string) => `${name} downloaded.`,
    /** The reminder that avoids the accident: a crate under version control cancels its own
     *  encryption. */
    keepOut: "Do not commit it: *.aos is in .gitignore, leave it there.",
  },
  import: {
    title: "Import a configuration",
    desc: "The file is read in memory. Nothing is written to the server's disk, and no existing project is touched: the import creates a new one.",
    pick: "Choose an .aos file",
    dropHint: "or drop it here",
    file: "File",
    passphrase: "Passphrase",
    passphraseHint: "The one used for the export.",
    preview: "Decrypt and preview",
    working: "Opening…",
    opened: (project: string) => `Crate opened: ${project}. Nothing is created yet.`,
    willCreate: "What will be created",
    nameLabel: "Name of the created project",
    nameHint: "New ids everywhere. The import touches no existing project.",
    apply: "Create the project",
    applying: "Creating…",
    cancel: "Cancel",
    created: (name: string) => `Project “${name}” created.`,
    counts: {
      environments: "Environments",
      agents: "Agents, with capabilities and access",
      repos: "Repositories",
      rules: "Rules",
      mcpServers: "Tool servers",
      templates: "Templates and chains",
      secrets: "Secrets, re-encrypted under this machine's key",
    },
  },
});
