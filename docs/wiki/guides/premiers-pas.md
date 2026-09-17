# Getting started

This guide starts from a fresh install and goes as far as a first running task.

## What you need first

Docker has to be running. Legion checks it before every launch and refuses cleanly if it does not
answer, but it cannot start it for you.

You need a Claude credential: an API key, or a subscription OAuth token. If both are present, the API
key wins. With neither, sessions run in mock mode, which lets you walk through the interface without
spending a cent but produces no code.

## Creating a project

A [[concepts/projet]] needs at least one repository and one [[concepts/agent]]. The simplest is to
declare the repository with its https URL.

If the agent must push, add a `GITHUB_TOKEN` secret to the project and tick it for that agent. Write
access without a credential is a certain refusal, and Legion says so at launch rather than letting the
session find out.

For a `git@` repository there is no token to add: give the path of a private SSH key in Settings →
Repos, and it covers reading and writing alike. The key must have no passphrase, since nothing can type
one inside a container.

Fill in the project's git identity. Without it, agents' commits carry the container's default
identity.

## Writing the first agent's role

The role prompt is what separates a useful agent from one that spills over. State its ground, its way
of verifying, and what it does not touch. Add the instruction to go to the inbox rather than cross its
boundary.

Grant it the repository in write, the `GITHUB_TOKEN` secret, and nothing else for now.
[[guides/capacites]] explains what to add next and why the default is to grant nothing.

## Setting the project context

The context is injected into every session. Put in it what is true everywhere: the stack, commit
conventions, verification commands, known traps. An agent that reads "mandatory check at the end of a
task: lint then build" will do it.

## First task

Pick something small and verifiable. Write a brief with the four parts described in
[[concepts/tache]], assign the agent, and run it.

Watch the Trace view while it runs. You will see every tool call live. It is the best way to
understand how your role prompt is really interpreted, and what the agent looks for when it cannot
find something.

## Next

When the session ends, the task moves to `review`. Read the diff in [[guides/pre-review]] and send
your comments back to the agent. That is where quality is decided.

## Opening something you have the id of

The palette opens with ⌘K. On top of commands, it recognises an id: paste a task's, a goal's, an
agent's or a project's, and the first line offered opens the matching page, with its name so you are
sure of the target.

You can also paste a whole application URL, the one you just copied from the address bar. It is the
most common move, and there is nothing to trim by hand.

If the id does not exist, the palette says so in plain words instead of claiming no command matches.
The two sentences mean different things.
