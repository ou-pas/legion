// The TEXT catalog of the inbox domain: the page, the question registry, the action receipt of an
// entry (question, wait, out-of-quota pause) and the form (v31).
//
// What is NOT interface copy stays where it is: a form's labels (`label`, `hint`, `placeholder`,
// options) are declared by the AGENT and arrive in the `FormSpec` — rendering them is the job of
// `inbox-form-field.tsx`, writing them is nobody's job here. The sanitizer's list of forbidden
// tags is not copy either: it is a security rule, not a sentence.
import { defineText } from "../i18n/catalog.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { plural } from "../ui/plural.js";

export const INBOX_TEXT = defineText({
  /** The reminder of the key that sends, under the answer field and next to a form's button.
   *  Enter alone stopped sending on 07/09 (ui/submit-key.ts): the operator fired off an answer by
   *  mistake. Same wording as the review comment editor. */
  // The SAME string as the task composer and the secrets card (07/09): one text for one gesture,
  // otherwise three screens end up saying the shortcut three different ways.
  sendShortcut: UI_TEXT.submitShortcut,

  page: {
    title: "Inbox",
    sub: "The only channel where agents interrupt you — mirrors the Discord bot",
    /** PASSIVE notifications (standups) — they come after anything awaiting a decision. */
    notices: "Notifications",
    markRead: "Mark as read",
    /** A notice that "comes back" on refetch has to say why (toast audit 24/08). */
    markReadFailed: "Notice not marked read",
    empty: {
      title: "No question waiting",
    },
  },

  /** The registry: all it does is count and frame. */
  panel: {
    title: (count: number) => `Inbox — ${count} ${plural(count, "decision")} waiting`,
  },

  /** THE WAITING PANEL of the bar (nav slice/03) — the summons, not the page. Its vocabulary
   *  separates what STOPS from what INFORMS, because that is the whole decision: the button's
   *  number is a debt that has to fall to zero, notices are read when you can and never swell
   *  it. */
  pending: {
    buttonWord: "waiting",
    buttonLabel: (count: number) =>
      `${count} ${plural(count, "decision")} waiting for an answer, across all projects`,
    title: "What is stopped",
    subtitle: (count: number) => `${count} ${plural(count, "decision")} · all projects`,
    /** Nothing stopped, but some notices: the panel is still useful, and it says so. */
    nothingStopped: "Nothing is stopped",
    /** Unfolding the compact panel: hovering shows the oldest, this button gives everything,
     *  grouped by project. */
    seeAll: (count: number) => `See all — ${count} ${plural(count, "decision")}`,
    /** Triage under an entry: the task, its nature when one is needed, its age. */
    questionMeta: (taskName: string, age: string) => `${taskName} · ${age}`,
    /** A ROUND carries its count (07/09): "AI-2200 · 2 / 6 · 1 h 52". That is what decides
     *  whether to pick it up now, and the panel is the only place you look at before choosing
     *  what to settle on. */
    roundMeta: (taskName: string, answered: number, total: number, age: string) =>
      `${taskName} · ${answered} / ${total} · ${age}`,
    /** A gate's gesture: you do not "answer" an approval. */
    approve: "Approve",
    gateText: (taskName: string) => `“${taskName}” is waiting for your approval`,
    gateMeta: (taskName: string, age: string) => `${taskName} · gate · ${age}`,
    entryLabel: (text: string) => `Open task — ${text}`,
  },

  item: {
    /** The triage fact: it decides the order you answer in. */
    waiting: (age: string) => `waiting for ${age}`,

    /** The blast radius: only the word is bold, not what it announces — so the sentence comes in
     *  two pieces, the dash travelling with the value. */
    impact: "Affects",
    impactValue: (what: string) => ` — ${what}`,

    evidence: "what the agent read",
    evidenceLabel: (agentName: string) => `Evidence excerpt — ${agentName}`,

    /** Free text stays on offer in EVERY case, even when choices are proposed. */
    reply: {
      label: (agentName: string) => `Answer ${agentName} in free text`,
      placeholder: "Your answer…",
      placeholderWithChoices: "Or answer in free text…",
      sendTo: (agentName: string) => `Send the answer to ${agentName}`,
      /** What the tooltip says when the button will not fire — it replaces a `title` on a
       *  disabled button, which the browser never shows. */
      nothingToSend: "Nothing to send: the answer field is empty",
    },
  },

  /** ATTACHING A FILE TO THE ANSWER (16/09). The case that asked for it: an interview where the
   *  answer IS a screenshot — "look, the dot is off here". The vocabulary is the brief's
   *  (`TASK_PAGE_TEXT.attachments`): attached by the operator, an INPUT, never a deliverable. */
  attach: {
    /** The keyboard gesture lives in the tooltip, not in a caption: the button is an icon on its
     *  own, and one more line under a 240px channel field costs a line of answer. */
    add: "Attach a screenshot or a file — or paste it (⌘V)",
  },

  /** The inbox form (v31): N questions in ONE pause. */
  form: {
    /** An unsalvageable agent SVG gives a STATED state, never a silent hole. */
    svgRemoved: "diagram removed: the SVG the agent supplied did not pass sanitization",
  },

  /** THE QUESTIONNAIRE (07/09, direction A): one question per screen, a rail that holds the
   *  thread, a recap to reread and send. The "required" gating here is only input comfort — the
   *  validation that counts is server-side, and its refusal comes back as a toast. */
  questionnaire: {
    railLabel: "Questions in this round",
    railHeading: (count: number) => `${count} ${plural(count, "question")}, then send`,
    progress: "Round progress",
    /** Under a rail entry: the answer chosen, or what the agent recommends, or nothing yet. */
    toDecide: "to decide",
    recommended: "recommended",
    recommendedValue: (label: string) => `recommended: ${label}`,
    /** The agent's context, folded at the top and never unfolded by default: you open it if you
     *  have a doubt. */
    context: (lines: number) => `What the agent read, and what this round decides · ${lines} lines`,
    prev: "Previous",
    next: "Next",
    toRecap: "See the recap",
    recap: {
      nav: "Recap and send",
      navSub: "reread, comment, send",
      title: "Reread before sending",
      lead: "What the agent will receive. Reopen a line to fix it; the comment covers the whole round.",
      edit: "edit",
      editLabel: (label: string) => `Edit the answer to “${label}”`,
    },
    /** ONE comment for the round, not one per question: what you have to tell the agent almost
     *  always overflows a single answer. "optional" is said, otherwise an empty field reads like
     *  a box to fill in. */
    comment: "Comment for the agent · optional",
    commentPlaceholder:
      "What the answers do not say: a nuance, a constraint, an order of priority.",
    /** A QUESTION'S NOTE (08/09): under each screen's options, optional. What you have to say
     *  about THIS question — a doubt, a condition — when the round comment would sit too far
     *  from it. */
    note: "Comment on this question · optional",
    notePlaceholder: "A doubt, a condition, what the options do not say.",
    noteRead: (text: string) => `Note: “${text}”`,
    send: (count: number) => (count === 1 ? "Send the answer" : `Send the ${count} answers`),
    /** What blocks sending, naming the questions — not an anonymous count. */
    missing: (indexes: readonly number[]) =>
      indexes.length === 1
        ? `1 answer missing (question ${indexes[0]})`
        : `${indexes.length} answers missing (questions ${indexes.join(", ")})`,
  },

  /** THE CARD (07/09) — the only rendering of a question outside its page. Four frames show it
   *  (the channel thread, the task page, the inbox list, the waiting panel) and its grammar does
   *  not change from one frame to the next: who is asking and since when, the title, what you can
   *  do. A multi-question form LEADS to its page; everything else is answered right here. */
  card: {
    round: (index: number) => `round ${index}`,
    /** The gauge: "2 / 6". Its accessible name says what it measures. */
    progress: (answered: number, total: number) => `${answered} / ${total}`,
    progressLabel: "Answers given in this round",
    draftAge: (age: string) => `draft ${age} ago`,
    /** The main gesture, and it SAYS which of the three you are doing: start, resume, reread. A
     *  single "Open" would have forced you to read the gauge first to know what was waiting. */
    answer: "Answer",
    resume: "Resume",
    review: "See the answers",
    /** The link's accessible name: in a list, "Resume" on its own does not say resume what. */
    answerLabel: (title: string) => `Answer — ${title}`,
    resumeLabel: (title: string) => `Resume — ${title}`,
    reviewLabel: (title: string) => `See the answers — ${title}`,
    /** The answers already given, at the top of the card. Three, then a count: beyond that you
     *  stop rereading and open it. */
    more: (count: number) => `+ ${count} more`,
    comment: (text: string) => `Comment: “${text}”`,
    answeredAt: (when: string) => `answered · ${when}`,
    answeredNow: "answered",
    /** A WAIT, a PAUSE: nothing to answer, and the card says so instead of offering a field that
     *  would suggest otherwise. */
    sleeping: (age: string) => `asleep for ${age}`,
    resumesAt: (when: string) => `resumes at ${when}`,
    /** In a list ROW, the nature fits in two words: a round's gauge, otherwise the number of
     *  choices, otherwise the fact that nobody is being waited on. */
    choices: (count: number) => (count === 0 ? "free text" : `${count} ${plural(count, "choice")}`),
    waitState: "waiting",
    nothingToAnswer: "Nothing to answer.",
    wakePlaceholder: "A word to resume right away…",
    wake: "Wake up",
  },

  /** A QUESTION'S PAGE (07/09) — "a question has its page". */
  question: {
    crumb: "Inbox",
    roundCrumb: (index: number) => `Round ${index}`,
    openChannel: "Open the channel",
    openTask: "Task page",
    /** The rounds bar. Each pill opens its page; the open one is marked in amber. */
    roundsLabel: "Interview rounds",
    roundPill: (index: number, count: number) =>
      `Round ${index} · ${count} ${plural(count, "question")}`,
    roundPillOpen: (index: number, answered: number, total: number) =>
      `Round ${index} · open · ${answered}/${total}`,
    /** The state of the save, top right. Silence is not a state: as long as nothing has been
     *  touched, the mention does not show at all. */
    draftSaving: "Saving…",
    draftSaved: (age: string) => `Draft saved · ${age} ago`,
    /** The server's refusal is stated plainly next to it: a "not saved" without a reason makes
     *  you reload the page, which is exactly the gesture that loses the work. */
    draftError: (why: string) => `Not saved: ${why}`,
    sent: "Answers sent, the session resumes",
    sendRefused: "Answers refused",
    /** READING. The page changes neither address nor shape once answered: it is the record. The
     *  header says who answered, because "you" and "the system" do not read back the same way
     *  (an automatic wake-up took no decision). */
    answeredByYou: (when: string) => `answered by you · ${when}`,
    answeredBySystem: (when: string) => `answered by the system · ${when}`,
    closedWithoutAnswer: "closed without an answer — the session stopped while waiting",
    readLead: "What the agent received.",
    /** An entry that is NOT a round (an out-of-quota pause notice, a wait on another task, a text
     *  or choice question) lands here from a pasted link or a list. It has no page: say so, and
     *  send it back to where it is answered. */
    notRoundTitle: "Nothing to answer on this page",
    notRound:
      "This entry is not a round of questions: it is read and answered on its card, in the task channel.",
    discarded: (suggestion: string) => `You turned down the recommendation (${suggestion}).`,
    readComment: "Comment",
    /** What came next: what the session did with these answers. The link leads to the filed task. */
    deposited: "filed",
    /** A question that no longer exists — a pasted link that has aged, a deleted entry. */
    absent: {
      title: "This question no longer exists",
      body: "The entry may have been deleted along with its task. The inbox lists what is still waiting for a decision.",
      back: "Back to the inbox",
    },
  },

  /** THE INBOX LIST (07/09): sorted by "needs me". The subheadings name the tiers, so you know
   *  why an entry is where it is. */
  list: {
    needsYou: "Waiting for a decision",
    waiting: "Will wake up on its own",
    answered: "Answered recently",
  },
});
