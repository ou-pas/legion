# Agent

An agent is a role: a prompt saying what it does and what it does not touch, plus the exact list of
what it is granted. It has no memory between two [[concepts/session|sessions]]. What it knows comes
from its prompt, the [[concepts/projet]]'s context, the active rules, and the repository it clones.

## The role prompt

It is the piece that matters most, and the easiest to botch. A good role prompt says three things:
the ground, the method, and the boundary.

The `front` role of the Legion project, for instance, says it works in `web/` only, reads the design
contract before writing a line, and touches neither `server/` nor `runner-payload/`. The boundary is
explicit: if a task requires crossing it, the agent asks in the [[guides/inbox]] instead of spilling
over.

That boundary is not cosmetic. It decides how tasks are cut. A task needing a server route and a
screen cannot go to just one of those two agents; it has to be split in two.

## What it is granted

Nothing by default. Each access is ticked: repositories, read or write; secrets, one by one; MCP
servers; skills; rules not already ticked "all agents"; a working folder; access to the shared
browser.

[[guides/capacites]] covers each of these.

## Model, effort, thinking

An agent can set its model, its effort level and its thinking budget. Without these settings, it
follows the project's complexity routing. Resolution goes from most specific to most general: the
step's setting, then the task's, then the agent's, then the project's.

## Engine

Two more settings live in the same block of the card. The preferred machine is SOFT: a
[[concepts/runner|runner]] name that goes first when the fleet arbitrates, but falls back to the least
loaded one if it stops answering. It differs from a task's chosen machine, which is hard and refuses
rather than falls back; see "Choosing a task's machine" in [[concepts/runner]].

Inbox access decides whether the agent can ask the operator a question or file one. Removing it goes
with an `allowedTools` that no longer carries the two inbox tools; keeping one without the other is
refused, and the refusal says so.

## The catalogue

Some agents come from a library: spec, plan, senior-dev, review-coordinator, librarian, and the
`feature` chain's interviewer, prober and slicer. They exist to be linked in a
[[guides/chaines|chain]], where each step hands over to the next.

## Read next

[[concepts/tache]] for what it is given to do, [[guides/capacites]] for what it is opened to.
