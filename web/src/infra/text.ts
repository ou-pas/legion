// Text catalog of the infra domain. It starts here, with the session cap (26/08): the rest of
// `InfraPage` still carries its sentences inline, and migrating them all at once would make a
// 350-line diff unrelated to that batch. Any NEW text of this domain goes through here.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const INFRA_TEXT = defineText({
  /** The screen subtitle, under the title "Runners" (General work, 02/09): the screen keeps only
   *  the fleet since version/identity/standup/webhooks left for System › General, and that had to
   *  be said here rather than left to be guessed. */
  intro:
    "The fleet of Docker machines: declaring a runner, its health, its capacity, its containers, and cleaning up its orphans.",
  /** The screen itself: its refresh, its two waits, and the fleet with nothing in it. */
  page: {
    refresh: "Refresh",
    loading: "Loading the state of the Docker runners…",
    errorTitle: "The infra API is not answering",
    errorBody:
      "The state of the Docker runners could not be read: containers, networks and zombie sessions stay unknown while the control plane does not answer.",
    retry: "Retry",
  },
  empty: {
    title: "No Docker runner enabled",
    /** Split around the `ssh://` code chip: the sentence reads through it. */
    lead: "No session can start until a runner is enabled — the local machine or an",
    tail: "host are declared in the system settings.",
  },
  /** The dense card (02/09): the labels of the two disclosures and their summaries. */
  card: {
    settings: "Settings — sessions, RAM, CPU",
    inventory: (n: number) => `Inventory — ${n} ${plural(n, "object")}`,
    orphans: (n: number) => `${n} ${plural(n, "orphan")}`,
    image: "Session image",
  },
  /** SHARED IMAGES (03/09) — until then a stale session image was visible, and a stale browser
   *  image was visible NOWHERE. The note says the same thing as for the session: what drifted,
   *  what it breaks, and the command that catches up. */
  sharedImages: {
    name: (key: "browser" | "proxy") =>
      key === "browser" ? "Shared browser image" : "Egress proxy image",
    /** Without the versions: we know the context changed, not what changed in it. */
    stale: (name: string) =>
      `${name} stale on this machine: it no longer matches what the repository describes.`,
    /** MISSING (09/09) — an image that was never built drifts from nothing, so `driftOf` returns
     *  `false` and the note never came out. The fact was missing, and the gesture with it. */
    absent: (name: string) => `${name} missing from this machine: it was never built there.`,
    /** With them — the browser case, and the sentence that would have named the 03/09 outage. */
    drift: (built: string, current: string) =>
      `It carries Playwright ${built}, the repository pins ${current}: chromium.connect() refuses a version gap, so any session driving the browser will fail.`,
    fix: "The next update rebuilds it by itself. To avoid waiting:",
  },
  /** REBUILD HERE (07/09). The global banner "run make image-session" did not name the machine:
   *  when portable-atelier slept through three updates in a row, the screen suggested a fleet-wide
   *  outage. The note is on the card, and the gesture with it. */
  rebuild: {
    sessionStale: (runner: string) =>
      `Session image stale on ${runner}: the session-runner.mjs burned into it is no longer the repository's. The next sessions there will run old code — most often because the machine was asleep during the update.`,
    /** MISSING (09/09) — the screen said it already, but in a note WITHOUT a gesture that pointed
     *  at a "make image" to type somewhere else. It is the more blocking of the two states: stale,
     *  the session starts with old code; missing, it does not start at all. */
    sessionAbsent: (runner: string) =>
      `Session image missing on ${runner}: no session will start there — the "docker run" fails on "No such image".`,
    button: "Rebuild here",
    running:
      "Rebuilding on this machine (2 to 4 min) — the note disappears when the image catches up with the repository.",
    started: (log: string) => `Rebuild started. Log: ${log}`,
    failed: (why: string) => `Rebuild not possible: ${why}`,
  },
  /** A PROJECT'S IMAGE, SEEN FROM THIS MACHINE (11/09) — the gap found alongside the batch "Image
   *  missing: offer to rebuild" (spec `/artifacts/J5tmew3aT8`): `image` above only probes the
   *  default tag, never the one a project names. NO BUTTON HERE, deliberately: the gesture already
   *  lives on the project page — the note points there. */
  projectImage: {
    absent: (project: string, runner: string) =>
      `Image of “${project}” missing on ${runner}: its sessions will not start there.`,
    stale: (project: string, runner: string) =>
      `Image of “${project}” stale on ${runner}: its sessions will run old code there.`,
    invalidDockerfile: (project: string, error: string) =>
      `Dockerfile of “${project}” refused: ${error}`,
    rebuilding: "Rebuilding — the gesture and the log are on the project page.",
    link: "Set it on the project page",
  },
  concurrency: {
    label: "Concurrent sessions",
    /** What the value means, in one sentence, under the field. */
    hint: (min: number, max: number) =>
      `Between ${min} and ${max}. One slot = one Docker container.`,
    load: (running: number, max: number) =>
      `${running} ${plural(running, "slot")} taken out of ${max}`,
    /** When going below what is already running: say what is NOT going to happen. */
    belowLoad: (running: number) =>
      `${running} ${plural(running, "session is", "sessions are")} running above this cap. They will finish: the queue simply stops starting new ones.`,
    save: "Save",
    saving: "…",
    saved: "Cap saved.",
    field: (name: string) => `Concurrent sessions on ${name}`,
  },
  memory: {
    label: "RAM per session",
    hint: "In MB. Storybook plus a driven Chrome ask for 2,500 MB at the very least.",
    field: (name: string) => `RAM per session on ${name}`,
    /** A container's limits are frozen at creation: say when this takes effect. */
    later: "Applies to the next sessions. Those running keep their limits.",
  },
  cpus: {
    label: "CPU per session",
    hint: "Fractions accepted. 1 = one whole core.",
    field: (name: string) => `CPU per session on ${name}`,
  },
  capacity: {
    /** The alert that was missing: the daemon's cap comes BEFORE ours. */
    over: (needMb: number, hostMb: number) =>
      `${fmtGb(needMb)} reserved in total, for ${fmtGb(hostMb)} available on the Docker side.`,
    overWhy:
      "Docker does not have that memory to give: sessions will be killed for lack of RAM, or its virtual machine will go down. Lower the RAM per session, lower the number of sessions, or raise the allocation in the Docker Desktop settings.",
    fits: (needMb: number, hostMb: number) =>
      `${fmtGb(needMb)} reserved at most, out of ${fmtGb(hostMb)} on the Docker side.`,
    unknown: "Docker did not say how much memory it has: the caps cannot be checked against it.",
  },
  /** The state of a machine, as seen by the periodic probe (01/09). This is NOT the verdict of the
   *  inspection under way: it is the one the server routes on. */
  health: {
    reachable: "docker reachable",
    unreachable: "docker unavailable",
    seen: (ago: string) => `last answer ${ago} ago`,
    never: "never answered since it was declared — no session will be sent there",
    /** When the probe and the inspection under way disagree. That is normal for a minute, and
     *  keeping quiet about it would make the screen doubtful. */
    lagging: "the probe has not caught up yet: it runs every 30 s",
  },
  /** The fleet's consumption (v52, 02/09) — three measures named for what they are: confusing them
   *  would produce wrong numbers with confidence. */
  metrics: {
    vm: "Sessions VM",
    vmHint:
      "What the session containers consume inside the Docker VM — the capacity that counts for starting one more session.",
    host: "The machine",
    hostHint:
      "The Mac hosting this VM, read over ssh — absent on a local runner or on a machine that is not a Mac.",
    disk: "VM disk",
    diskHint:
      "The disk space OF THE VM itself — not that of the host machine. A full VM makes every session started on it fail.",
    cpu: "CPU",
    mem: "Memory",
    /** The axis in SMALL next to the headline number — the cell has no room for whole names. */
    cpuShort: "cpu",
    memShort: "mem",
    age: (ago: string) => `measured ${ago} ago`,
    diskOf: (gb: string) => `of ${gb}`,
  },
  /** The blind spot of 03/09 (v54): a disabled runner was not even probed, so whatever was left on
   *  its daemon (a browser service created when it still served) was invisible. One word for the
   *  panel's tag, one sentence for the banner that announces it. */
  disabled: {
    tag: "disabled",
    residueTitle: "Residue on a disabled runner",
    banner: (n: number) =>
      n === 1
        ? "A disabled runner still carries Docker containers or networks: nothing cleans them up while they stay outside the active fleet."
        : `${n} disabled runners still carry Docker containers or networks: nothing cleans them up while they stay outside the active fleet.`,
    // 08/09 — THE CLEAN CASE DESERVES ITS OWN SENTENCE. A disabled runner with no residue appeared
    // nowhere, so neither did its re-enable button. It is listed now, and this text says what it is
    // — a sleeping machine — rather than passing it off as an alert.
    idleTitle: "Outside the active fleet",
    idle: (n: number) =>
      n === 1
        ? "One runner is disabled: it takes no session and carries nothing to clean up. The power button on its card returns it to the fleet."
        : `${n} runners are disabled: they take no session and carry nothing to clean up. The power button on their card returns them to the fleet.`,
  },
  /** DISABLING / DELETING A RUNNER (web relay, 04/09) — the gesture lives in the card header, next
   *  to the daemon's last answer: it is a lifecycle gesture on the MACHINE, not an inventory
   *  setting. Disabling destroys its containers in the same gesture on the server side (`cleanup`
   *  confirms it): the confirmation says so before, not after. */
  lifecycle: {
    disable: "Disable",
    disableConfirm: "Disable — containers destroyed?",
    disableAnnounce: (name: string) =>
      `Disabling ${name}: its containers, networks and volumes will be destroyed. Confirm or cancel.`,
    /** Re-enabling cleans nothing up (`setRunnerEnabled` on the server side): nothing to confirm. */
    enable: "Re-enable",
    /** Warning for a local runner when it is re-enabled (05/09): it shares the control plane's disk
     *  and can fill it. This warning only appears for the local runner (no dockerHost), since a
     *  remote runner does not carry that risk. */
    localRunnerWarning:
      "A session running on this runner shares the control plane's disk and can fill it. The disk guard refuses a launch under 4 GB free, but the risk remains. Three 3 GB sessions on 11 GB shared — decide before re-enabling.",
    delete: "Delete",
    deleteConfirm: "Delete permanently?",
    deleteAnnounce: (name: string) =>
      `Delete the declaration of ${name} and clean up what it still carries. Confirm or cancel.`,
  },
  /** The Docker inventory of a machine, folded away: what an object is, and what owns it. */
  inventory: {
    imagePresent: "present",
    imageAbsent: "absent",
    cleanup: (n: number) => `Clean up ${n} ${plural(n, "orphan")}`,
    cleanupConfirm: "Delete permanently?",
    cleanupAnnounce: (n: number, runner: string) =>
      `Cleaning up ${n} ${plural(n, "orphan object")} on ${runner}: confirm or cancel.`,
    /** Split around the `legion-*` code chip. */
    noContainersLead: "No",
    noContainersTail: "container on this runner.",
    running: "running",
    orphan: "orphan",
    /** The fallback name of a container's task when the task no longer carries one. */
    task: "task",
    browser: "shared browser",
    diskSentinel: "disk sentinel",
  },
  /** The panel of one machine: its vitals, its daemon when it is silent, and its zombies. */
  panel: {
    vitals: (name: string) => `Vitals of ${name}`,
    places: "Slots",
    nobody: "nobody",
    /** Split around the `ssh://` code chip. */
    unavailableLead:
      "Docker is not answering on this runner: no session will start there. Start the daemon (Docker Desktop, or the reachable",
    unavailableTail: "host), then refresh.",
    daemonMessage: "Daemon message:",
    cleanupPartial: (errors: string) => `Partial cleanup — failures: ${errors}`,
    cleanupFailed: "Cleanup not possible: ",
    reapFailed: "Sweep not possible: ",
    /** A session marked running whose container is gone: the task behind it waits for nothing. */
    zombies: (n: number) =>
      n === 1
        ? "A session is marked running while its container has exited: nobody witnessed its end, and its task stays blocked."
        : `${n} sessions are marked running while their containers have exited: nobody witnessed their end, and their tasks stay blocked.`,
    zombiesSweep: "The automatic sweep ends them within 30 seconds — or right now:",
    reapNow: "End now",
  },
  /** The fleet seen from the bar, on hovering the Docker indicator. */
  statusCard: {
    title: "Runner fleet",
    load: (running: number, max: number) => `${running} / ${max} slots`,
    degraded: (n: number) => `${n} ${plural(n, "machine")} degraded`,
    open: "Open Runners",
  },
  declare: {
    title: "Declare a machine",
    desc: "A second Docker machine, reachable over ssh://. Nothing to install on it: the control plane calls its daemon, and a probe checks every 30 s that it answers before sending a session there.",
    name: "Name",
    nameHint: "This is the name an agent carries in its runner preference.",
    host: "Docker host",
    hostHint: "Empty = the local socket of this machine.",
    callback: "Callback address",
    /** The trap this address avoids, in one sentence — without it, the remote container calls back
     *  ITS localhost, where there is no control plane. */
    callbackHint:
      "The address of THIS control plane, as seen from the remote machine. Empty = the local server's.",
    concurrency: "Concurrent sessions",
    submit: "Declare",
    submitting: "Declaring…",
    /** Created but silent: it will receive nothing until the probe hears it. The panel has already
     *  closed (success = machine declared): this text goes out as a toast, not as a banner. */
    silent: (name: string, why: string) =>
      `“${name}” is declared, but its daemon did not answer: ${why}. No session will go there while it stays silent.`,
  },
});

/** MB into readable GB: "9 GB", "2.5 GB". Caps are thought of in GB, set in MB. */
export function fmtGb(mb: number): string {
  const gb = mb / 1024;
  return `${gb >= 10 || Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)} GB`;
}
