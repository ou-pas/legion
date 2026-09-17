// The text of the PROJECT page (Configure): what it says when no project is picked, its header,
// the name of its tabs, and the repositories every session clones with each one's test command
// (`repos`, now rendered under the REPOS tab). The other tabs have their module next door
// (`context.ts`, `models.ts`, `secrets.ts`, `danger.ts`, `ssh-key.ts`): one tab, one catalog.
// "Chains" had its own (`chains.ts`) before merging into Library on 12/09 — see `chains/text.ts`.
import { defineText } from "../../i18n/catalog.js";

export const PROJECT_PAGE_TEXT = defineText({
  /** With no project in the URL, the page has nothing to describe: it says where to pick one. */
  empty: {
    title: "Project",
    heading: "No project selected",
    why: "This page describes one project. Pick one in the left rail to see its repos, its context and its test command.",
  },

  title: (project: string) => `Project · ${project}`,
  /** The header chips: the slug and the output folder are data, only their `title` (what the
   *  hover explains) and the word "model" are copy. */
  defaultModel: (model: string) => `model ${model}`,
  defaultModelWhy: "Project default model",
  fsRootWhy: "Output folder (fsRoot)",

  /** THE SEVEN SECTIONS (batch nav/2a — eight tabs ordered by the database TABLE, now seven
   *  ordered by the QUESTION you are asking). They are ROUTES since slice nav/09, listed by the
   *  rail (`projects/rail-sections.ts`) and titled by their screen. The ampersand is written as
   *  itself: these are JavaScript strings, not JSX text — it was the vanished TabList that forced
   *  the `&amp;` entity.
   *
   *  `general` absorbs the former Context tab and what lived under "Secrets & identity" (name,
   *  color, id); `repos` absorbs the git identity and the SSH key — three settings that answered
   *  the same question, "where do I touch git".
   *
   *  `models` used to say "Models & quota": the quota card left on 30/08 and the name was lying.
   *  The section now carries the default model AND the routing.
   *
   *  `chains` merged into Library on 12/09 (`/project/chaines` now redirects): the role → agent
   *  mapping it carried now lives under each installed chain. */
  tabs: {
    general: "General",
    repos: "Repos",
    models: "Models",
    secrets: "Secrets",
    /** `integrations` reads with `secrets` and sits right after it: what you CONNECT on one side,
     *  what you PASTED on the other. A connection is not a secret from the operator's point of
     *  view — the secret is its consequence, not the gesture. */
    integrations: "Integrations",
    danger: "Danger",
  },

  repos: {
    title: "Project repos",
    listLabel: "Project repos",
    /** The description is cut by three <code> elements (the clone folder, the branch, the PR
     *  file): four pieces, in render order. It lived inline in the TSX while these keys slept
     *  next door, out of date; fixed on 16/09, along with what it said.
     *
     *  IT USED TO CITE GITHUB_TOKEN AND GITLAB_TOKEN as a setting to check for the agent. These
     *  secrets are no longer set by hand since the connections work: you connect a provider in
     *  the Integrations tab, and the secret is its consequence. The sentence sent the operator to
     *  the wrong place.
     *
     *  v29: the text does NOT promise that the test command is run by the system. It never was —
     *  it is asked of the agent in its opening prompt, and nothing checks that it did it. A
     *  screen that describes an intention inspires a confidence nothing backs; that lesson was
     *  already paid for on the Environments screen. */
    descClone: "Every session clones the repositories granted to its agent into ",
    descBranch: ", all on the same branch ",
    descCross:
      ", which lets one task touch the front and the back together. The repositories an agent receives are checked on the Agents page, and forge access is connected in the Integrations tab. The test command is asked of the agent before it writes ",
    descEnd: "; nothing runs it in its place.",
    /** A project without a repo is not an unfinished project: it works on the filesystem. */
    none: "No repo — this project works through the Legion filesystem only.",

    nameLabel: "Short name",
    nameHint: "The clone folder: ./repos/<name>",
    namePlaceholder: "e.g. front",
    urlLabel: "Repo URL",
    /** The two ways in, and what covers each: the hint NAMES the secret of the chosen forge —
     *  a generic "the right secret" is what sends an operator looking through three screens. */
    urlHint: (secretName: string) =>
      `https (the ${secretName} secret covers the repo) or SSH git@host:path (the project key covers the clone).`,
    /** THE FORGE FIELD ONLY SHOWS WHEN NOTHING ANSWERS FOR IT (16/09): asked for a host no
     *  connection covers, where guessing would present the wrong credential. */
    forgeLabel: "Forge",
    forgeHint:
      "No connection of this project talks to that host. Decide which secret is presented to git and which review API is called.",
    forgePlaceholder: "to be chosen",
    forgeUnknownHost: "Unknown host — choose the forge to continue.",
    urlPlaceholder: "https://github.com/org/repo.git",
    add: "Add the repo",
    /** The bin's `title` ALSO says the side effect — an agent's access goes with it. */
    remove: "Delete the repo (also removes the agents' access)",

    testCommand: "Test command",
    testCommandPlaceholder: "e.g. pnpm test",
    /** VARIANT B — a repository without a command does not show one more empty field. It says
     *  what it lacks, and the gesture opens the field already focused. One empty field per row
     *  reads as expected input; most repositories have none and expect none. */
    noTestCommand: "No test command",
    setTestCommand: "set one",
    /** The field repeats row after row: its accessible name has to name the repo. */
    testCommandFor: (repo: string) => `Test command of repo ${repo}`,
    saveTestCommand: "Save the command",
  },

  /** THE REPOSITORY PICKER (16/09) — a fact is fetched, a choice is asked. A repository URL is a
   *  fact the forge knows; making it typed by hand was the flaw. */
  repoPicker: {
    loading: "Reading repositories from the forges…",
    /** The empty state that has an EXIT: nothing is connected, and the unblocking gesture has a
     *  name. */
    noConnection: "No provider connected on this project",
    noConnectionHint:
      "A GitHub or GitLab token opens the repository list, and fills the git identity of commits on the way.",
    goToIntegrations: "Connect a provider",
    empty: "No repository reachable with the connected tokens",
    /** Truncation is SAID, with the number and the exit — a list silently cut short reads as
     *  "this repository does not exist". */
    truncated: (cap: number) =>
      `List limited to the first ${cap} repositories. Beyond that, declare the URL by hand just below.`,
    failed: "A forge did not return its repositories",
    retry: "Retry",
    private: "private",
    /** The short name is DERIVED from the full path: that is the second input disappearing. The
     *  button is an icon, so its `title` is ALL a screen reader hears — ten "Add" buttons would
     *  not be distinguishable from one another. */
    addAria: (fullName: string) => `Add repository ${fullName}`,
    manualToggle: "Declare a URL",
    /** THE FOOT OF THE LIST (16/09) — the list no longer claims to be exhaustive, and the
     *  sentence that says so carries the gesture that repairs it. It replaces the `Disclosure`
     *  stuck at the bottom of the card.
     *
     *  It SWALLOWED the friction sentence that lived under the "Reachable" header (the same day,
     *  when the headers went). The two followed each other and both said a repository can be
     *  missing. What is left is the only fact the operator cannot guess: an organization that
     *  restricts third-party applications disappears WITHOUT an error until one of its admins has
     *  approved the access. */
    manualFooter:
      "A missing repository can be declared by its URL. An organization that restricts third-party applications only appears once one of its admins has approved the access.",
    /** This is not a convenience fallback: a mirror, a private instance, another account's
     *  repository will never be in the list. */
    manualHint:
      "For a repository the connections cannot see: a mirror, a private instance, the repository of an account that is not connected.",
    /** A stored identity ANNOUNCES itself. A value that appears on its own elsewhere is a
     *  surprise. */
    adopted: (name: string, email: string) =>
      `Git identity for commits filled from the forge: ${name} <${email}>. Editable just below.`,
  },
});
