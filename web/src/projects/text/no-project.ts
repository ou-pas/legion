// THE SCREEN YOU ONLY SEE ONCE, and it decides everything: it is the first contact with Legion.
// It does not start by asking "what is your project called", it starts by saying whether the
// ground holds — a Claude credential, Docker answering, the session image present.
//
// Every condition that fails names the GESTURE that repairs it, in full. That is the difference
// between a preflight and a prompt: a prompt lets you create a project whose first task will die
// wordlessly in a container that does not exist.
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const NO_PROJECT_TEXT = defineText({
  title: "Nothing to run yet",
  lede:
    "A project is a repository and the agents allowed to touch it. It arrives with a default" +
    " agent and an open environment: the first task starts with no other setting.",

  preflight: {
    label: "The ground",
    /** "2 of 3" — the count of conditions met, at the top of the block. */
    score: (met: number, total: number) => `${met} of ${total}`,
    checking: "Reading the ground…",
    met: "met",
    unmet: "to do",
  },

  identity: {
    title: "A Claude credential",
    ok: "Read from the control plane environment.",
    /** The gesture, when there is nothing: the two variables the control plane reads. */
    fix:
      "No credential read. Put an API key or a subscription token in the control plane" +
      " environment, then restart it.",
    fixCommand: "ANTHROPIC_API_KEY=… # or CLAUDE_CODE_OAUTH_TOKEN=…",
    kind: { "api-key": "api key", oauth: "oauth", none: "none" },
  },

  docker: {
    title: "Docker answers",
    ok: (runners: number) => `${runners} ${plural(runners, "runner")} declared, all healthy.`,
    fix:
      "No runner answers. Start Docker, then reload: without a daemon, a session has nowhere" +
      " to run.",
    fixCommand: "colima start",
    none: "No runner declared.",
  },

  image: {
    title: "The session image is missing",
    okTitle: "The session image is there",
    ok: "Built and up to date.",
    fix: "Without it a session starts and dies silently. Two minutes of building.",
    fixCommand: "make image-session",
    name: "legion-session",
  },

  field: {
    label: "The repository the agents will work on",
    placeholder: "git@github.com:org/repo.git",
    create: "Create",
    creating: "Creating…",
    /** The derived line: what the URL says, before anything is saved. */
    derived: (name: string, forge: string) =>
      `project ${name} · forge ${forge} · one senior-dev agent and an open environment`,
    derivedUnknownForge: (name: string) =>
      `project ${name} · forge not guessable from this host, pick one in Settings → Repos`,
    derivedNothing: "Paste the clone URL: the project name and the forge follow from it.",
    /** WHY the button is waiting. The list of unmet conditions is passed in by the caller: "the
     *  button is waiting for the session image" reads, "the button is disabled" does not. */
    blocked: (what: string) =>
      `The button is waiting for ${what}: creating the project would work, but the first task would go nowhere.`,
    blockedWhat: {
      identity: "a Claude credential",
      docker: "Docker to answer",
      image: "the session image",
    },
  },

  demo: {
    title: "Look before plugging in your repository",
    body:
      "A demo project, with tasks on its board. Nothing runs, nothing costs — the server refuses" +
      " to start an agent in it — and it deletes itself in one gesture.",
    open: "Open the demo",
    opening: "Opening…",
  },
});
