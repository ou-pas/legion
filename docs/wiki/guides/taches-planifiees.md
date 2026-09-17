# Scheduled tasks

A scheduled task is a rule that produces work at a fixed time. It lives in a project, under Scheduled,
and each firing creates an ordinary [[concepts/tache]] that the rest of Legion handles like any other.

## What a rule holds

A name, which becomes the title of the task it produces. A cron expression. And a target: either an
[[concepts/agent]] the task is given to, or a chain to instantiate. Never both, and never neither.

The brief is the text given to the agent. For a chain, it is the request passed to the model.

A rule can be disabled without being deleted. It then keeps its history and simply stops firing.

## The cron expression

Five space-separated fields: minute, hour, day of month, month, day of week. Each field accepts a
star, a value, a comma-separated list, a range with a hyphen, and a step with a slash.

```
0 7 * * 1-5      every weekday at 07:00
*/15 * * * *     every quarter of an hour
0 9 1 * *        on the 1st of each month at 09:00
30 2 * * 0       on Sundays at 02:30
```

Sunday is written 0 or 7, both work. An expression that does not follow this form is refused on save,
with the reason. Nothing invalid is stored.

When day of month and day of week are both set, the rule fires if either one matches. That is the
usual cron convention, and it often surprises: `0 0 1 * 1` fires on the 1st of every month and also
every Monday.

## Everything is UTC

The times you write are UTC times, not local ones. A `0 9 * * *` fires at 09:00 UTC, which is 10:00
or 11:00 in Paris depending on the season.

That is a choice, not an oversight. A rule expressed in local time shifts twice a year, and when
clocks go back it fires twice in the same night. Dates shown on screen are converted to your time
zone.

## What happens when it fires

The rule creates a task in the Todo column, assigned to its agent. It does not run it itself: the
queue does, exactly as for a task created by hand. The [[concepts/runner]]'s session ceiling,
priority and start refusals therefore apply without exception.

Each due time leaves a trace, visible when you open the rule. A trace says what happened: the task
was created, the rule was disabled, the due time was missed, or creation failed and the reason is
shown.

## Missed due times are not caught up

If the control plane is off at the scheduled time, the rule does not fire on the next start. It
records a "missed" trace and resumes from the next due time.

Catching up would launch all of the night's runs at once, on a repository and a database that have
changed since. "Run now what was supposed to run at 3 am" is almost always wrong, and silence would
be worse: the trace says so.

A short delay is still honoured. Under five minutes, the due time fires normally, which covers a busy
server or a slightly slow migration.

## When a rule fails

The error is recorded with its message, and the rule still moves on to the next due time. Without
that, the same error would be rewritten every thirty seconds and the trace would become unreadable
instead of saying what is wrong.

The most common cause is a deleted agent. The rule keeps firing and failing until it is given another
agent, or disabled.
