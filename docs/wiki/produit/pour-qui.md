# Who it is for, and what for

One user, a developer, sole operator of their own system. The product is built for them and has
never claimed to be multi-user. Many choices only make sense in that light: a single operator
token rather than accounts, secrets decrypted on the server with a local master key, a control
plane that drives Docker on machines it owns.

It is a workstation, not a showcase. Information density and triage speed come before
explanation. A system state speaks in precise terms, `waiting · 8 min` rather than "the agent is
thinking".

Most use happens on a large screen. The phone is for triage: see what is waiting, answer a
question, approve. The phone is also where the agent comes to find you, through a push
notification, instead of waiting for you to come back.

## What the product must make possible

See at a glance what needs you, and deal with it without opening three screens. Pending gates,
open questions and failures arrive in the same place, the waiting panel in the top bar.

Follow a session live without reading raw logs. Tool calls, cost, diff and artifacts read as a
story, not as terminal output.

Launch a task from anywhere and move on. The command palette opens the composer on every screen,
and the queue takes over when there is no free slot.

Review code before it lands. Comment line by line, pile up remarks without sending them, send
everything in one gesture, and find the agent back at work on the same branch.

Supervise a long objective without breaking it down yourself, while keeping hold of what matters:
the definition of done, the budget, the stop.

Configure an agent and see exactly what it is granted and what it is refused. No permission
should have to be guessed.

## What it does not try to be

A team tool. Nothing in the data model knows what a user is; the operator session only proves
that whoever holds it holds the token.

A hosted service. The control plane starts containers through Docker daemons it reaches directly,
on its own machine or over SSH on machines it owns. Offering it to strangers would mean separating
tenants, which nothing does.

A replacement for the terminal. An agent works in a container with the usual Claude tools, and
you keep your own terminal for everything that goes faster by hand.

See also [[produit/ce-qu-est-legion]] and [[concepts/agent]].
