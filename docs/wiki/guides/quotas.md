# Quotas

A Claude subscription has limits per window, five hours and one week, and the Opus week is counted
separately. Legion does not measure them. It does recognise the refusal when it arrives, put the
session that received it to sleep, restart it on another account if one is left, and otherwise wake
it on its own at the reset.

## What happens at the ceiling

On the first refusal, the session stops. It does not retry in a loop: the work in progress is pushed
to the branch, then the session goes to sleep.

An [[guides/inbox]] entry appears, dated with the reset time. The container is destroyed during the
wait, so nothing consumes.

## Several accounts

A project can carry several subscriptions, in an order you set. The first in the list serves, alone.
The others wait.

The Claude credentials card, in the project's Settings next to the secrets, shows that list and
answers "why is my session running on this account": each one's rank, its label, and whether it is
exhausted, and until when. The label follows the window that closed the account: "exhausted until
19:12 (5 h)", "… (week)", or "… (week (opus))". Rank is changed with the arrow, an account is added
with just its token (it goes last), and removed from the same card.

When a session dies at the ceiling, the account it was using is marked exhausted, on the window that
closed and until the announced reset time. That state is shared: other sessions read it instead of
each rediscovering it, and every rediscovery would have cost a container start.

If an account is still available, the session restarts on it straight away, on the scheduler's next
tick. The inbox entry names both accounts, the one that just closed and the one taking over. An
account just marked exhausted is never retried before its reset, so failover does not go round in
circles.

If every account in the project is closed, sessions sleep, and that is the normal behaviour. The
wake-up is set on the nearest reset among them, not on the account that just died.

The list only carries subscription tokens. An API key stays a project secret, read only if the list
is empty: when every subscription is closed, Legion waits rather than switching to pay-as-you-go,
because spending should not decide itself because of an outage.

## Waking up

The scheduler checks every thirty seconds for pauses that are due. Once the time has passed, it
answers the inbox entry itself and the session restarts, with a margin of a few minutes after the
announced reset.

You stay in control: answering before the time wakes it at once. The automatic wake-up then finds the
entry already closed and duplicates nobody.

The session resumes where it stopped, with its resume counter incremented. It does not start the task
over.

## Why there is no gauge any more

The top bar used to show the most constrained window, and a project's card detailed it window by
window. Both were removed on 30 August, and the day before was spent establishing why rather than
guessing.

A plan's usage percentage can only be read with a credential from a normal login. The token the
control plane carries comes from `claude setup-token`, and it is refused everywhere: on
`/api/oauth/profile`, on `/api/oauth/usage`, and even in the CLI, where `claude -p "/usage"` silently
falls back to a cost summary, exactly as with an invalid token. It is not an implementation defect, it
is a scope that this kind of token lacks.

Two workarounds were examined and rejected. Reading the system keychain from the server asks for
authorisation again on every Node update, and would only ever give the machine's account. Running
`claude -p "/usage"` inside a session container with the project's credential yields nothing either,
since that credential is precisely the one lacking the scope.

What remained was to show a correct number for the default case and nothing for the others. That was
refused: a gauge that only measures some accounts has to be interpreted before it can be believed.
"Not measurable with this token" is a confession, not information, and it had been taking up room in
the bar for weeks.

If you are wondering where the percentage went, that is the answer. Bringing it back first needs a way
of measuring that works for every account, not a rewrite of the screen.

## Read next

[[concepts/session]] for statuses, [[guides/inbox]] for answers.
