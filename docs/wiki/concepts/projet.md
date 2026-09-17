# Project

A project is the container for everything else: its repositories, its [[concepts/agent|agents]], its
secrets, its rules, its skills, its default model. Two projects share nothing. An agent belongs to one
project and never sees another's repositories.

## What a project holds

Git repositories, declared with their URL and their [[concepts/forge|forge]]. Over https, access goes
through a token, and the token is a project secret ticked agent by agent. Over `git@` or `ssh://`,
access goes through the project's SSH key, described below. Either way, when the credential is missing
Legion refuses the launch before starting anything, rather than letting the session discover the
problem after spending a model turn. A project can mix GitHub and GitLab; each repository then carries
its own secret.

A project can give the path of a private SSH key, which makes `git@` repositories legitimate. The
setting keeps a path, never a key: the key's value does not enter the database, does not leave in a
[[guides/coffre|crate]] and is displayed nowhere. The control plane mounts the file read-only into the
container, which makes a copy with its own ownership, because ssh refuses a key it does not own.

If a `known_hosts` file sits next to the key, it is mounted with it. It is the file ssh would read on
your machine for that key, so there is nothing more to point at, and it lets you add an internal forge
without rebuilding the session image.

Three things are worth knowing before pasting a path. A passphrase-protected key will never work, since
nothing can type the passphrase inside a container; Legion checks it and says so at launch. A deploy key
per repository is better than a personal key, which opens everything the account can reach. And the path
is the Docker host's: on a remote runner, it is the path on that machine, not on yours.

The key covers reading and writing alike, so an SSH repository needs no token.

Secrets, encrypted in the database with AES-256-GCM, the master key living outside the database. The
interface shows a secret's name and the agents granted it, never its value. An agent receives in its
environment only the secrets ticked for it.

A secret also accepts an optional label, which you can set at creation or change later without pasting
the value again. The label is not encrypted, on purpose: it stays readable when the value no longer is,
which is exactly when knowing which key is broken is useful. A secret without a label is shown by its
variable name.

A default model, and a routing table by complexity. A `low` task goes to haiku, a `med` one to the
project's default model, a `high` one to opus. You can force a model on a specific task when creating
it.

A context, free text injected into the prompt of every session in the project. It is the place for what
is true everywhere: conventions, settled architecture choices, known traps.

A git identity, which signs the commits agents push. Without it, commits carry the container's default
identity, which makes the history unreadable.

The email address matters more than you would think. A well-formed address is not necessarily one the
forge links to an account, and when it does not, commits arrive anonymous: a plain-text name, a grey
avatar, no link to anyone. Nothing flags it at push time. So the card asks the forge, when it can,
whether the configured address is among the verified addresses of the account holding the token, and
says so on the spot. It suggests the account's primary address when it knows one.

Three answers are possible and the third matters as much as the other two: attributed, not attributed,
or unverifiable when the token is not allowed to read the account's addresses. A project that has
already run with an orphan address gets the warning in the inbox when its next session launches, once
per address. It never stops a task: a misattributed commit can be fixed afterwards, an interrupted
session costs more than the defect it would prevent.

## Its name and its id

A project's name shows everywhere and can be changed freely. The id underneath is computed from the
name, never typed, and it does not always follow: it is also the name of the folder where the project's
artifacts live, under `data/fs/`.

It follows when there is nothing to move, that is, when the project has never had a session and its
folder is empty. That is the case for a project just created or imported, which is precisely when you
notice you named it badly.

It also always follows when you chose an explicit output folder: the id then designates no path.

Otherwise it stays, and saving says so with the reason. Moving the folder would be possible, but a move
that half fails leaves a project with part of its history unfindable, and a filesystem has no
transactions.

The Legion project itself never changes id: that is how Legion recognises itself at startup, and
changing it would spawn a second Legion project at the next seed.

## How its sessions run

A project can name the Docker image for its sessions. With none, it is the control plane's, which ships
node, git, make and pnpm. A project whose tests need something else, PHP or Python for example, names
its own rather than bloating everyone else's image. It must exist on the Docker host: a missing image is
not pulled, the launch fails and says so.

## The demo project

A project flagged as demo is read-only. No session starts in it, whatever the runner. Its data stays
frozen, which lets you walk through the interface without breaking anything.

## Read next

[[guides/capacites]] details what an agent is granted and why the default is to grant nothing.
[[concepts/agent]] describes the role itself.
