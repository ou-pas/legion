# Inbox

The inbox is the only channel an agent uses to interrupt you. There are no scattered notifications: a
question asked during a session arrives here, and nowhere else.

## What happens there

An agent that asks a question goes to sleep. Its status moves to `waiting` and its container is
destroyed. Nothing runs and nothing costs while the question waits.

Your answer resumes the session where it stopped. It is not a fresh start: the model's conversation
picks up, with your answer as the last message.

## Question shapes

A choice: the agent offers options, you pick one. The most common shape and the quickest to handle.

Free text: you write the answer.

A form: the agent composes several blocks, markdown, an SVG diagram, typed fields, and you answer all
of it at once. This shape exists to avoid the chain of questions that costs a pause on every turn.
It is called a round.

In every case, Enter sends nothing. The answer goes with the button or with Cmd+Enter (Ctrl+Enter
outside macOS), as in Slack, Linear or GitHub: an answer resumes a session, and a send by mistake
cannot be taken back. In a text area, Enter inserts a line break.

## A card everywhere, a page to answer

A round of several questions is not filled in inside a channel column or under a scrolling thread:
it has its own page. Everywhere else you see a card, and the card leads there.

The card always has the same shape: who is asking and for how long, the question's title, and what
you can do with it. On a round it shows where you are, "2 / 6", and offers Answer if you have not
started, Resume otherwise. On an answered question it shows the first answers and See the answers.
A wait that will wake up on its own says so and offers no field.

That card is the last message in the task's channel, it sits at the top of the task page, it makes
up the rows of the Inbox page, and it is the row in the bar's waiting panel. Four places, the same
object, the same move.

A text question, a choice question and a one-question form are answered directly on the card: that
is already one move, and going to a page for one click would add nothing.

## Answering a round

A round's page opens from any card, at `/p/<project>/inbox/<question>`. At the top: the task name,
the agent asking, how long it has waited, and two ways out, Open the channel and Task page.

A round reads one question per screen. The title is the question, the agent's argument sits below,
then the options. When the agent recommends an answer, it is already ticked and marked
"recommended", with its reason underneath. You can keep it or pick another. Next moves to the
following question, Previous goes back; Cmd+Enter means Next.

What the agent read and what its answers will touch, the receipt an ordinary question shows in full,
are folded at the top of a round. They stay available if you have doubts but do not open on their
own: each question's argument is what matters for deciding.

On the left, a rail lists the questions. Under each one appears what you answered, or what the agent
recommends if you have not been there yet, or "to decide". Clicking an entry goes straight to it. A
bar under the list shows where you are.

Under each question's options, an optional comment field holds what you want to say about that
specific question: a doubt, a condition, what the options leave out. The agent receives it next to
the answer, and it works for every field type, text fields included: the field value is the answer,
the note is what you think of it.

The last rail entry is the summary. It lines up the questions and your answers, marks the ones where
you followed the recommendation, shows your notes under the answers that have one, and leaves a
missing answer pending, underlined. An "edit" button reopens the question. Below the list, an optional
comment for the agent applies to the whole round, not to one question. That is where you write what
the answers do not say: a nuance, a constraint, an order of priority. Sending happens from this
screen, and stays blocked while a required question has no answer; the message says which.

A round with a single question has neither rail nor summary: the question, the comment and the send
button fit on one screen, and that screen is the card itself.

On a narrow screen, the rail moves above the questions, as a scrolling strip.

Once the answers are sent, a message confirms it and you go back to where you came from: the channel,
the task page, the inbox. The session resumes with your answers as the last message.

## The draft

Every change on a round's page is saved half a second later, in the database and not in the browser.
The label at the top right says so: "Draft saved · 3 s ago". You can settle two points on the train
and finish at the office, or close the tab without losing anything.

The draft is what makes cards say "2 / 6", and Resume rather than Answer. It changes nothing about
the question's state: it stays open, the session sleeps exactly the same, and the bar counter counts
the same. Answering clears it, since it no longer describes anything.

If saving fails, the label says so with the server's reason. The most common case is a question
answered in the meantime from Discord or another tab: the page then switches to read-only by itself.

## The rounds of an interview

An interview is a series of rounds. They are listed as pills at the top of the page, "Round 1 ·
4 questions", and each one opens its page. The one you are on is marked in accent, the ones still
waiting for an answer in amber.

A round's number is its position among its task's questions, in the order they were asked. Nothing is
stored: notices that ask nothing of anyone, a task wait or a quota pause, do not count.

## Failure diagnostics

When a session ends badly, Legion opens an inbox entry with a diagnostic and two buttons: run the task
again with that diagnostic, or leave it in review.

These entries expire on their own. If the task gets a new session by another route, the diagnostic
closes with a trace saying why: acting on it would start a second session in parallel.

A real question asked by a live agent never expires automatically. It holds a waiting session.

## Evidence

A question can carry a code excerpt, a file, a screenshot. That lets you answer without opening the
repository.

## Rereading a decision

An answered question leaves the inbox, which only shows what is waiting. Its page keeps the same
address and the same shape: the form goes, the questions and your answers stay. A link pasted
somewhere still leads to the same place, and the history of an interview is simply the sequence of
its pages.

The read-only page says who answered and when, lines up questions and answers, marks the ones where
you followed the agent, and spells out the ones where you did not: "You turned down the
recommendation (separate task)". A note left on a question reads under its answer; the round comment
is the last line. If the session filed a task afterwards, a link names it.

A decision is read through what it turned down, and showing only the chosen option would make a
trade-off look obvious.

The task's channel keeps the full thread: the choices offered, the one you took, what the agent had
read and what impact it announced.

## Discord and webhooks

The inbox is mirrored to a Discord bot if you configure one, which lets you answer from a phone.
Outgoing webhooks receive the same events and are there to connect something else.

With no text channel configured, the daily summary lands in the application's inbox.

## Read next

[[guides/quotas]] for pauses that wake up on their own, [[concepts/session]] for what happens during
the wait.
