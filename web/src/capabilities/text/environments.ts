// The text of the ENVIRONMENTS registry: the list (name, allowed hosts, agents using it), the
// form that declares one and its inline editing.
//
// THIS TEXT WAS REWRITTEN ON THE EVENING OF 25/08, and it is worth saying why. It claimed that an
// agent without an environment has NO network access: that was the intention of task 08, never the
// behavior — the runtime opened everything. That morning's switch made the sentence true; that
// evening's decision ("we drop the network limits for now") made it false again. A screen that
// describes an intention rather than a behavior is a trap: it inspires a confidence nothing backs.
// These sentences therefore describe what happens, and nothing else.
//
// The DO NOT of task 08 still holds: no button offers to create a "wide open" environment. What is
// created here is an allowlist; openness is the absence of a wall, not an object you build.
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const ENVIRONMENTS_TEXT = defineText({
  title: "Environments",
  desc: "An allowlist of domains applied to the session's network proxy. An environment RESTRICTS the agents you assign it to: without one, a session goes out unrestricted. It is the only path that walls off an agent's network.",

  emptyTitle: "No environment on this project",
  emptyBody:
    "So no agent of this project is walled off: their sessions reach whatever they want. Create one below to restrict those carrying something sensitive (a write token, an API key).",
  listLabel: "Project environments",

  /** A neutral reminder, always shown under the list: it is the only place in the app where the
   *  network perimeter can be read at a glance. Neither red nor a triangle — this is not an alert,
   *  it is a fact you draw your own conclusions from. A SHORT label (the Inset small-caps it) —
   *  the count and the sentence live in the body, not in the label. */
  noEnvironmentLabel: "Without environment",
  noEnvironmentBody: (n: number) =>
    `${n} ${plural(n, "agent of this project is", "agents of this project are")}` +
    " attached to no environment: their sessions go out unrestricted.",

  row: {
    hostCount: (n: number) => (n === 0 ? "no host" : `${n} ${plural(n, "host")}`),
    noHosts: "no allowed host",
    agentCount: (n: number) => (n === 0 ? "no agent" : `${n} ${plural(n, "agent")}`),
    noAgents: "no agent references this environment",
    openLabel: "open network (inherited)",
    openHint:
      "Networking set to “open” before this screen existed (seed) — no restriction. This page does not convert it into an allowlist; rename it or remove it from the agents that reference it.",
    edit: "Edit",
    cancel: "Cancel",
    delete: "Delete the environment",
    deleteBlocked: (n: number) =>
      `Delete — refused while ${n} ${plural(n, "agent references", "agents reference")} it`,
  },

  form: {
    addLabel: "Add an environment",
    nameLabel: "Name",
    namePlaceholder: "e.g. limited",
    hostsLabel: "Allowed hosts",
    hostsHint: "Comma-separated — domains the egress proxy can reach.",
    hostsPlaceholder: "github.com,registry.npmjs.org",
    submit: "Create the environment",
    save: "Save",
    cancel: "Cancel",
    openNetworkingHint:
      "Networking set to “open” — the allowlist below is not applied while it stays on that value.",
  },
});
