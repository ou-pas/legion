// The composer's exits: run, save for later, or discuss first. Three gestures, two mutations: "run"
// and "later" differ by a boolean, while "discuss" creates ANOTHER task, given to the interviewer,
// with its own model. Split from `TaskComposer.tsx` on 06/09 so the provider does not know the ORDER
// in which a task, its attachments and its run go out.
import { useMutation } from "@tanstack/react-query";
import { chainsApi } from "../api/chains.js";
import { type Agent } from "../api/agents.js";
import { TASK_STATUS, tasksApi } from "../api/tasks.js";
import { startInterview } from "../interviews/start-interview.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { useToast } from "../ui/toast.js";
import { type PickedAttachment } from "./attachments.js";
import { type Classify, type Level } from "./task-composer-context.js";
import { COMPOSER_TEXT } from "./text/composer.js";

export interface TaskSubmit {
  launch: () => void;
  defer: () => void;
  discuss: () => void;
  pending: boolean;
  discussing: boolean;
}

export function useTaskSubmit(input: {
  project: { id: string } | null;
  /** The BASE agents, not the project's: the interviewer gets installed if missing. */
  allAgents: Agent[];
  text: string;
  detail: string;
  effectiveMode: string;
  isTemplate: boolean;
  gate: boolean;
  readOnly: boolean;
  complexity: Level;
  priority: Level;
  proposal: Classify | null;
  attachments: PickedAttachment[];
  canLaunch: boolean;
  canDiscuss: boolean;
  /** Resets the composer. Named because THREE gestures clear it (run, later, interview): copying six
   *  `setState` each time is how a field ends up surviving a submit. */
  reset: () => void;
  onLaunched?: () => void;
}): TaskSubmit {
  const {
    project,
    allAgents,
    text,
    detail,
    effectiveMode,
    isTemplate,
    attachments,
    reset,
    onLaunched,
  } = input;
  const { push } = useToast();

  // TWO gestures, one mutation: `engage` decides between running and only saving. Two mutations
  // would duplicate validation, invalidation and cleanup.
  const submit = useMutation({
    mutationFn: async (engage: boolean) => {
      const name = text.trim();
      const brief = detail.trim();
      if (!name || !project || !effectiveMode) throw new Error(COMPOSER_TEXT.missingFields);
      // For a chain the "request" IS the brief: the title alone would be a truncated instruction for
      // the nine steps reading it.
      if (isTemplate) {
        await chainsApi.runTemplate(effectiveMode.slice(4), brief ? `${name}\n\n${brief}` : name);
        return;
      }
      const task = await tasksApi.createTask({
        name,
        projectId: project.id,
        agentId: effectiveMode,
        approvalGate: input.gate,
        readOnly: input.readOnly,
        complexity: input.complexity,
        priority: input.priority,
        // The TYPE has no selector and never will: it drives nothing, it NAMES the branch (slice
        // nav/15). Absent (proposal not back yet, immediate run) the server sets `chore`, the same
        // fallback as the classifier.
        ...(input.proposal ? { type: input.proposal.type } : {}),
        ...(brief ? { description: brief } : {}),
        ...(engage ? {} : { status: TASK_STATUS.later }),
      });
      // Attachments upload BEFORE the run, and a failure STOPS the run: the session spec is built at
      // start and NAMES the files present at that moment. Running first would send an agent told
      // about a capture it will not find, or worse not told about one arriving a second later. The
      // task stays created: attach from its Brief view, then run again.
      for (const file of attachments)
        await tasksApi.uploadAttachment(task.id, {
          name: file.name,
          contentBase64: file.contentBase64,
        });
      // Full capacity: the task is queued, not an error that should block the UI.
      if (engage) await tasksApi.runTask(task.id).catch(() => {});
    },
    onSuccess: (_r, engage) => {
      reset();
      // Saving is a SILENT gesture: from the dashboard there is no board in sight to watch the task
      // land. Without this acknowledgement you cannot tell the click took.
      if (!engage)
        push({
          tone: "ok",
          title: COMPOSER_TEXT.deferredTitle,
          body: COMPOSER_TEXT.deferredWhy,
        });
      onLaunched?.();
    },
    // Do not swallow a real error (createTask/runTemplate failing): queueing is handled above, this
    // is a hard failure and goes up to the user.
    onError: (e: Error, engage) =>
      push({
        tone: "bad",
        title: engage ? COMPOSER_TEXT.launchFailed : COMPOSER_TEXT.deferFailed,
        body: e.message,
      }),
  });

  // DISCUSS FIRST (D2), the composer's other exit. It creates the INTERVIEW task, given to the
  // interviewer, not the work task. Neither the proposed agent, nor complexity, nor gate apply: a
  // different job, with its own model.
  const discussing = useMutation({
    mutationFn: () => {
      if (!project) throw new Error(COMPOSER_TEXT.noProject);
      return startInterview({
        agents: allAgents,
        projectId: project.id,
        subject: text.trim(),
        brief: detail,
        priority: input.priority,
        // Attachments go this way too (16/09). `launch` sent them and `discuss` left them behind: an
        // interview opened on a screenshot started without it, and nothing said so.
        attachments,
      });
    },
    onSuccess: (r) => {
      reset();
      if (r.installed)
        push({
          tone: "ok",
          title: INTERVIEW_TEXT.start.installed,
          body: INTERVIEW_TEXT.start.installedBody,
        });
      // A task created but not started yet is not a failure: the server says why it waits, relayed
      // as is rather than announcing an interview that is not running.
      push(
        r.queued
          ? { tone: "wait", title: INTERVIEW_TEXT.start.started, body: r.queued }
          : {
              tone: "ok",
              title: INTERVIEW_TEXT.start.started,
              body: INTERVIEW_TEXT.start.startedBody,
            },
      );
      onLaunched?.();
    },
    onError: (e: Error) =>
      push({ tone: "bad", title: INTERVIEW_TEXT.start.refused, body: e.message }),
  });

  // Double-submit guard: the button is already disabled, but ⌘/Ctrl+Enter in the name field calls
  // launch() directly (plain Enter does nothing since 07/09, ui/submit-key.ts). Without the
  // isPending guard two tasks would start.
  return {
    launch: () => {
      if (input.canLaunch && !submit.isPending) submit.mutate(true);
    },
    defer: () => {
      if (input.canLaunch && !submit.isPending) submit.mutate(false);
    },
    discuss: () => {
      if (input.canDiscuss && !discussing.isPending) discussing.mutate();
    },
    pending: submit.isPending,
    discussing: discussing.isPending,
  };
}
