# Forge

A forge is where a repository is hosted: GitHub or GitLab. Each repository of a
[[concepts/projet|project]] declares its own, and that choice decides two things. The secret the
container presents to git when it clones and pushes, and the API queried to open a change request and
read its comments.

A project can mix both. A front end on GitLab and a vendored library on GitHub live side by side with
no special setting, provided both secrets exist and are ticked for the agent that touches them.

## Why it is declared rather than guessed

The host is not enough. `gitlab.com` is recognisable, `git.my-company.com` is not, yet it is a GitLab
like any other. Legion therefore suggests the forge when it recognises the host, and asks you to decide
otherwise. Guessing would mean presenting the wrong credential, and the failure would only arrive at
clone time, inside the container, blaming a secret that was in fact granted.

You can correct a repository's forge afterwards, in the project's Settings, Repos section. Repositories
created before this question existed are read as GitHub.

## The expected secret

GitHub wants `GITHUB_TOKEN`, GitLab wants `GITLAB_TOKEN`. They are two separate secrets, on purpose:
ticking one never gives access to the other. The pre-launch check reads the forge of each granted
repository and refuses to start if the matching secret is missing, naming which one.

A GitLab group token covers every project in its group, which is enough for a multi-repository project.
On GitHub, a fine-grained PAT is issued by one organisation and covers only that one: two organisations
currently need two separate setups.

## The hosts a token can be presented to

A project's token is sent to the repository's host as soon as that repository declares its forge.
Declaring the forge is the authorising move: you type the URL and pick `github` or `gitlab` from the
menu next to it, so you named the host and the token in the same form. A self-hosted instance has
nothing more to do, no environment variable, no restart.

What stays refused is guessing. An `https` repository whose forge is neither declared nor certain from
the host receives no credential, and the refusal says which move unblocks it. That rule, not a host
list, is what keeps a GitHub token from landing on an arbitrary server.

`LEGION_FORGE_HOSTS` still exists, and only one entry point reads it: importing a crate. A crate is a
file written on another machine, so its content is not your move: whoever writes the file is not whoever
writes the list. The allowed hosts there are `github.com`, `gitlab.com`, and the ones you declare in
that variable, comma-separated, with their port if they have one.

Until 8 September this list decided everywhere, and the cost showed on a Framagit project: the
repositories were declared, the token granted, and the clone died asking for a username because the
variable was not set on the server. The repositories predated the list, so nothing had ever asked for it
to be filled, and the diagnosis existed only in the internal log.

## What does not change from one forge to another

Clone, fetch, commit, push. That is git, identical everywhere, and the container does not even know
which forge it works on. It receives a username and an environment variable name, writes one line in
its credential store, and that is all.

The difference in vocabulary does stay visible. GitHub says pull request, GitLab says merge request,
and the interface uses the word of the forge concerned.

## The change request title

Many repositories have their CI check pull request titles, and reject one without a conventional type.
Legion therefore always suggests a title carrying one, and the type comes from the task's branch:
`feature/` gives `feat:`, `bugfix/` gives `fix:`, `chore/` gives `chore:`. A branch from anywhere else,
a resumed PR's for example, gives `chore:`, the label that lies least when you do not know. That
computation needs neither network nor token, so it cannot fail.

That guarantees the form, not the style. Two repositories of the same project do not necessarily put
the issue id in the same place, write in the same language, or use scopes. So Legion reads the latest
merged pull request titles of each repository the agent can push to, keeps the compliant ones, and
shows them as examples in its brief. One example conveys the language, the scope and the id's position
in a single line.

That read needs the network and the project's token, so it can fail. It never blocks anything: without
examples, the agent keeps the conventional commits rule and the title keeps its type. The failure does
appear in the session trace, because silence cannot be told apart from the absence of a problem.

One last detail that matters on a squash-merging repository: the PR title becomes the message of the
commit landing on the default branch, and the body is dropped. An issue id tucked at the bottom of the
description would not survive, which is why those repositories put it in the title.

## Inbound webhooks

The forge can ring Legion when a change request moves. Merged: the task in review that carried it moves
to done on its own, its blocked tasks are released, its chain moves on, a notification goes out. Closed
without merging: nothing moves, but the task records it in its activity. Connecting happens repo by
repo, from a button in the project's Settings → Repos, once the public URL is set in System → General;
see [[guides/webhooks-entrants]].

The webhook is a doorbell, never a source of truth. The payload, even signed, only serves to find
candidate tasks; the decision rereads the real state of the change requests on the forge, and a task
only finishes if the API says all of its change requests are merged. An event the server could not
verify is refused, asking the forge to deliver it again, rather than silently lost.

## What is left to do

The GitLab adapter has not yet run against a real instance. Its endpoints follow the v4 API
documentation and its tests exercise it against a fake API, which proves it reads compliant responses
correctly, not that GitLab answers that way. The first real run will fix what needs fixing.

Pushing a branch and opening a change request are two independent paths. The first depends on no API:
if creating the MR goes wrong, the branch is pushed anyway and you can open it by hand.

See also [[concepts/projet]] and [[guides/pre-review]].
