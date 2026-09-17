# Concierge

The concierge reads the control plane and talks to you about it. It answers "what ran overnight",
"why is slice 09 not moving", "how much did I spend this week", from what the server already knows.

It changes nothing. Ever. That is a product guarantee, not an intention: its session receives no
tool, no MCP server, no repository setting, and a last safety net refuses and interrupts if a tool
were offered to it anyway. Ask it to approve a gate and it will tell you it can only inform.

## Two places, two uses

The icon in the bar opens a panel. That is the quick question, asked in the middle of something
else, from any screen. Its footer leads to the page.

The `/concierge` page is where you come back to. It carries the situation report, and the
conversation below it. The relationship is the same as between the inbox badge and the inbox.

## The situation report

When you arrive on the page, you read what needs a decision before asking anything. It is the first
turn of the conversation, not a banner above it.

It is written in sentences, not counters. "3 sessions" gets read and filed; "slice 09 has been
stopped for 40 minutes on an approval nobody saw" says what to do about it. Below the prose, what
is waiting is sorted into three levels: now, soon, for info. The tasks it cites are links, so the
decision and the thing to decide on are not two screens apart.

Those links come from the server, not the model. The compiled context carries the real task ids,
the model can only copy them, and any id that was not in the context loses its link before it
reaches the screen.

## Why it does not refresh itself

Every situation report is a model call, so it costs money. It is computed when you open the page,
cached for about ten minutes, and never recomputed on a timer. A clock that calls a model spends
while you sleep.

The timestamp shows its age, and "refresh it" redoes it. That is the only move that costs a call.

Until a project has run, there is no situation to report: the page says so and offers to create a
project, rather than calling a model to be told nothing has moved.

## Conversations

What you asked yesterday is still there. Turns are written server-side, so a conversation survives a
reload and picks up where it stopped. The page lists them next to the situation report, most
recently fed first; each has its own address, so it can be reloaded or sent. Opening one from the
list does not change screens, it takes the place of the current conversation.

A question asked from the bar panel goes into the same memory. The panel and the page do not keep
two histories.

## What it sees

Recent tasks from every project, the week's sessions with their cost, open inbox questions. The
concierge is not scoped to a project: it crosses the whole control plane, which is exactly what you
want when you do not yet know where to look.

It does not see repository contents, artifacts, or session traces. If the context has nothing to
answer with, it says so instead of making something up.

See also [[guides/inbox]] for the channel an agent uses to interrupt you, and [[guides/quotas]] for
what the concierge reads when you ask it about spending.
