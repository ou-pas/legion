// The text of the SSH key — out of the Runtime tab on 09/09, extracted into its own catalog in
// batch nav/2a: it answers "how does this project touch git", like the repositories and the commit
// identity, not "what do its sessions run with". One tab, one catalog — same rule as the others.
import { defineText } from "../../i18n/catalog.js";

export const SSH_KEY_TEXT = defineText({
  title: "SSH key",
  why:
    "The path of the private key git will present to git@… repositories. This field holds a " +
    "PATH, never the key: its value does not enter the database, does not leave in a crate and " +
    "is displayed nowhere. The control plane mounts the file read-only in the container.",
  label: "Private key path",
  hint: "Path ON THE DOCKER HOST — on a remote runner, it is that machine's path.",
  placeholder: "/Users/me/.ssh/id_project",
  /** The three things you otherwise discover at the bottom of a log, after a round of the model.
   *  Three named keys and not an array: `TextCatalog` only accepts sentences and groups, and a
   *  list would type as `TextEntry[]` — so potentially as functions, which JSX cannot render. */
  passphrase:
    "A key protected by a passphrase will not work: nothing can type it inside a container.",
  deployKey:
    "Prefer a deploy key per repository over your personal key, which opens everything your account reaches.",
  hostKeys:
    "Your key never enters the image: it is mounted, read-only. What the image carries are the PUBLIC fingerprints of github.com and gitlab.com, which stop a server from impersonating them.",
  knownHosts:
    "A known_hosts file placed NEXT TO your key is mounted with it. That is what lets you add an internal forge without rebuilding the image.",
});
