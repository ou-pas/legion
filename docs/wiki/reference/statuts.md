# Statuses

The complete list, with what each status guarantees.

## Task statuses

`later` is the parking lot. No task leaves it on its own, even with a scheduled date. It is the only
column nothing leaves without a human move.

`todo` is the queue. A task entering it will be launched as soon as a [[concepts/runner]] has room. The
scheduler passes every thirty seconds, so every path leading to todo ends in the same launch.

`doing` means a session is running. This status is set when the session starts, whatever the starting
column.

`review` awaits your reading.

`done` closes the task. Only a done task can be archived.

Transitions are constrained: `later` only connects to `todo`. The board and the API apply the same rule.

## Session statuses

`starting`: the container is being created. After four minutes without a container, the session is
stopped and its task goes back to `later` with a notice.

`running`: the agent is working.

`waiting`: the agent is waiting for an answer. The container is destroyed, which is the normal behaviour
of the pause. A dependency wait and a quota sleep carry this status too: nobody has anything to answer,
they wake up on their own.

`blocked`: the agent is stopped on an approval decision. It is not asking for information, it is asking
for the right to do something. Same pause as `waiting`, same destroyed container, but one more
guarantee: no automation writes to a blocked session, only your answer resumes it. A refusal is named,
never silent.

`committing`: the work is being pushed.

`destroyed`: normal end of an ephemeral container. It is not a failure.

`failed`: abnormal end. A reason is always attached, persisted on the session and published in the
trace. A session never becomes terminal silently.

## Worth knowing

A `waiting` session has no container, on purpose. Nor does a `blocked` one. A `starting` session does not
have one yet. A `running` session without a live container is an anomaly, picked up by the periodic
sweep.

Stopped is not finished. `waiting` and `blocked` are live states: the session will resume, its task is
not over, and its project cannot be deleted.

The bar counter only counts what waits for a decision from you. A session sleeping on another task or
until the end of a quota window is not in it: you could not bring it down, and a counter that never goes
down stops being looked at. Those waits stay readable in the inbox.

A failure diagnostic offering to run the task again expires as soon as the task gets a new session. A
real question asked by a live agent never expires.

## Read next

[[reference/depannage]], [[concepts/session]].
