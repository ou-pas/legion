// The text of the SESSIONS tab: the image the project's sessions run in, and the Dockerfile that
// layers over it.
//
// THE SSH KEY IS GONE (batch nav/2a): it answered "how does this project touch git", not "what do
// its sessions run with" — its text now lives in `ssh-key.ts`, next to the Repos screen that
// carries it.
//
// One tab, one catalog — same rule as `context.ts` and the others.
import { defineText } from "../../i18n/catalog.js";

export const SESSION_RUNTIME_TEXT = defineText({
  tab: "Sessions",

  image: {
    title: "Session image",
    why:
      "The docker image this project's sessions run in. Empty = the control plane's, which ships " +
      "node, git, make and pnpm. A project that needs something else — PHP for a pest run, " +
      "Python for a pytest run — names its own here rather than growing the image of every " +
      "other project.",
    label: "Image reference",
    hint: "Must exist on the docker host: a missing image is not pulled, the launch fails.",
    placeholder: "legion-session:latest",
  },

  dockerfile: {
    label: "Dockerfile",
    hint:
      "A thin layer pasted here, not versioned in the project repository. Empty = nothing more " +
      "than the image above. Otherwise: first line “FROM” followed by that image (or the base " +
      "image if it is empty), then only RUN, ENV and USER — no COPY, there is no build context " +
      "to copy from. The base runs as “agent”, which can install nothing: switch to “USER root” " +
      "before the apt-get, and back to “USER agent” at the end, or this project's sessions will " +
      "run as root.",
    placeholder:
      "FROM legion-session:latest\nUSER root\nRUN apt-get update && apt-get install -y php8.2-cli\nUSER agent\n",
  },

  save: "Save",
  saved: "Saved",

  // The state of the image this project ACTUALLY uses, on each runner — the visibility that was
  // missing (Kopee.me outage, 09/09): see server/src/infra/project-image.ts.
  runnerImage: {
    absent: (runner: string) => `missing on “${runner}”`,
    stale: (runner: string) => `stale on “${runner}”`,
    invalidDockerfile: (error: string) => `Dockerfile refused: ${error}`,
    build: "Build here",
    building: "Building…",
    started: "Build started — see the log.",
    failed: (message: string) => `Build refused: ${message}`,
  },
});
