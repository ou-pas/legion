// The launch refusals of `pickRunnerRow`, typed (05/09).
//
// `runTask` used to decide "queue or fail" by looking for the word "capacity" in the message.
// That contract had already bitten twice: the "no reachable runner" refusal (v51) and then "not
// enough disk" (04/09) each had to be worded to avoid that word. An `instanceof` cannot be
// bypassed by accident. The messages did not change: they are what the operator reads.

/** Every reachable machine is full. The only refusal that justifies queueing: a slot will free
 *  itself. */
export class NoCapacityError extends Error {
  override readonly name = "NoCapacityError";
}

/** No machine answers. Not a queue that moves: the operator has to wake something up, so the
 *  task must surface the error. */
export class NoReachableRunnerError extends Error {
  override readonly name = "NoReachableRunnerError";
}

/** Every machine with a free slot is short on disk. Waiting frees nothing: the operator has
 *  cleanup to do, not a ceiling to raise. */
export class NoDiskError extends Error {
  override readonly name = "NoDiskError";
}

/** 12/09: the image `docker run` would use is not on the chosen machine. As a bare `Error` the
 *  queue could not tell this refusal apart and relaunched the task against the same missing image
 *  every thirty seconds. The type carries the facts the reaction needs (which machine, which
 *  image), because reading them back from the message was the fragile version of the same thing.
 *
 *  Not a fleet refusal (waiting for a slot does not bring an image back) and not a task refusal:
 *  the machine lacks the image, and the repair (rebuild) is offered once for every task that
 *  hits it (`image-wait.ts`). */
export class ImageAbsentError extends Error {
  override readonly name = "ImageAbsentError";
  readonly runnerId: string;
  readonly runnerName: string;
  readonly image: string;

  constructor(message: string, facts: { runnerId: string; runnerName: string; image: string }) {
    super(message);
    this.runnerId = facts.runnerId;
    this.runnerName = facts.runnerName;
    this.image = facts.image;
  }
}

/** v66: the task designates a machine (`tasks.chosen_runner_id`) and that machine is unusable
 *  (removed from the registry, or disabled). Not a queue either, and above all not a silent
 *  fallback to another machine, which would cancel the operator's choice. The refusal goes up to
 *  the operator, who changes the choice or turns the machine back on. */
export class ChosenRunnerError extends Error {
  override readonly name = "ChosenRunnerError";
}
