# Taking a project away in a crate

A crate is an encrypted file holding what it takes to recreate a project elsewhere: its agents and
their grants, its repositories, its rules, its tool servers, its templates, and, if you ask, its
secrets. You make one from the Crate section of the project's Settings, and it only opens with the
passphrase you chose.

It answers a precise question: how to set up, on a second machine, a project that took weeks to
configure, without copying seven agent cards by hand and without sending credentials in clear.

## What the crate holds

The project itself, with its context, its model routing and its default skills. The agents, with
their capabilities and their access. The network environments, which always travel with the
agents. The declared repositories, the rules, the tool servers, the templates and the chains. And
the secrets, if the box is ticked.

Environments are not a separate box, on purpose. An environment carries an agent's network policy.
An agent imported without its own would fall back to an open network, a privilege escalation
nobody asked for.

## What it does not hold

Tasks, sessions, artifacts, history. A crate is configuration, not a backup: you take what you need
to rebuild the set, not the record of what was played on it.

Runners neither, because a runner describes a machine and the machine changes on arrival. The
master key stays where it is too.

Skill contents do not travel. A skill is a folder on disk, and the crate carries only its name. A
name with no folder behind it is ignored when the session is delivered, as everywhere else in the
product.

## Exporting

Open the project's Settings, Crate section. Every section has its own address, so this one can be
bookmarked and sent as a link. The numbers next to each line are your project's, read before you
are asked anything: you see what you are taking before you pick a passphrase.

Secrets are unticked by default. Ticking them shows a warning, and it is serious: losing the
passphrase means losing the file. Nothing reopens it, not you, not the control plane.

The passphrase is typed twice. Twelve characters minimum, and a whole sentence beats a complicated
word. The second entry is not a formality: a passphrase mistyped the same way twice produces a
perfectly valid crate that nobody can open.

The file lands in your downloads folder. It has the `.aos` extension and exists nowhere on the
server.

## Importing

An import CREATES a project, so it is not a setting of an existing one. It lives in the New project
modal, in the Import a crate tab next to the blank form. Drop the file, type the passphrase, then
ask for the preview. Nothing is created at that point: the preview opens the crate and tells you
what would be created, with the counts and the caveats.

If the passphrase is wrong or the file damaged, the screen says so and nothing is written. The
message does not tell the two cases apart because nothing can.

An import always creates a new project. It does not merge, replace, or touch any existing project.
Ids are new, and the links between agents, rules and tool servers are rebuilt by name. Secrets are
re-encrypted under the arriving machine's master key.

After the import, review your agents' folder access: it describes paths on the original machine,
and the crate copies them without translating them.

## The file itself

A header line in clear, then the body encrypted with AES-256-GCM. The header carries only what is
needed to re-derive the key: no project name, no date, no account. An `.aos` found on a USB stick
does not say where it came from.

It stays readable for one reason. The day the format changes, an older version will be able to say
"this file is format 2, I can only read 1" instead of failing on the passphrase and sending you
looking for a sentence you typed correctly.

Derivation goes through `scrypt` and takes about a second. That is intended: it is what makes a
dictionary attack tedious on a file that leaves the machine.

## Do not commit it

`*.aos` is in the repository's `.gitignore`. Leave it there. A versioned crate cancels all its
encryption the day someone reads the history.

See also [[guides/capacites]] and [[concepts/projet]].
