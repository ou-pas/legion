# Troubleshooting

Failures already met, and what causes them.

## A task stays in doing with no live session

The board is lying. It happens when a session ends without anyone noticing.

The periodic sweep catches `running` sessions whose container has disappeared and moves their task back
to `review`. Sessions stuck in `starting` without a container are stopped after four minutes and their
task goes back to `later`.

If the state persists beyond that, restart the control plane: recovery also runs at startup.

## A session is marked as having lost its container while it was working

The sweep queries Docker every thirty seconds with `docker inspect`, under a five-second budget. On a
remote runner, that call goes through an `ssh` every time, and one stalling `ssh` is enough: the session
is shot down, receives its SIGTERM, pushes what it has and exits cleanly. The board then says "failed"
for work that exists on the branch.

Since 7 September, the end reason carries what the probe saw, and that is where to read. Three forms:

- `inspect: stopped` or `inspect: removed`: Docker answered, the container is gone. The verdict is
  reliable, the cause is in the session trace.
- `PROBE WITHOUT A VERDICT — code 124`: Docker did not answer within the budget. The container may have
  been alive. Look at the runner's load at that moment.
- `PROBE WITHOUT A VERDICT — code 255`: the ssh transport failed. The container was probably alive. Look
  at the network between the control plane and the runner.

The same detail is in the payload of the session's `status` event (`probe`, with the code, stderr and
duration in milliseconds) and in the `recover` entry of the log.

In the last two cases, the commit pushed by the stop hook is on the task's branch: running the task again
starts from there.

## Sessions do not start at all

Check that Docker answers. Since the preflight probe, an unreachable daemon causes an immediate, named
refusal at launch, without creating a session.

If sessions got stuck in `starting` before you fixed Docker, the sweep will collect them, with a notice
for each.

When session shutdown says `No such image: legion-session:latest`, the image was never built on that
machine, or it was wiped. The machine's card in System → Runners says so and carries the same Rebuild
here button as a stale image: two to four minutes, and sessions start again. The task stays in `doing`,
what was dropped in the artifacts is kept, and Run the task again is enough afterwards.

If Docker answers and sessions still fail one by one, look at the Identity card in System → General. It
says what the control plane authenticates with, and flags two defects nothing else names: no credential
set, and a subscription token stored in `ANTHROPIC_API_KEY`. The second is the most treacherous, because
the API refuses the token without saying why and the failure then looks like an infrastructure outage.

## Every session dies at the same round number

It is not an agent bug, it is a ceiling. A series of sessions dying at exactly two minutes, or exactly ten
minutes, points at a timeout in the infrastructure, not at the agent's work.

The failure diagnostic produced in that case is misleading: it is built from the trace, and a trace cut
off sharply looks like a compilation error. Always compare durations before believing a diagnostic.

## A clone fails

For a private https repository, check that the `GITHUB_TOKEN` secret exists on the project and is ticked
for that agent.

For a `git@` or `ssh://` repository, check that the project declares an SSH key, in Settings → Repos.
Without a declared key, the launch is refused and says so. With a key, three failures are named before
the container even starts: the file is missing or unreadable, the path points at the public key instead
of the private one, or the key is passphrase-protected, which nothing can type inside a container.

A valid key that still fails on `Permission denied (publickey)` means the forge does not know that key:
it is fixed on the forge side, not in Legion. A `Host key verification failed` means the host is not in
the keys stamped into the session image, which covers github.com and gitlab.com: rebuild the image naming
the host, or put a `known_hosts` next to the project key (see [[concepts/projet]]).

## A session runs old code

The runner payload lives in the session image. If you changed those scripts without rebuilding the image,
sessions still run the old version.

System → Runners compares the payload hash stamped into the image with the one on disk and, when they
diverge, says so on the card of the machine concerned. That card's Rebuild here button replays the rebuild
for that machine alone. The usual case is a machine that was asleep during the update, see
[[guides/mettre-a-jour]].

## A pull request goes into conflict

Normal on a branch cut before other work landed. Merge the default branch into the task's branch,
resolve, check it builds, and push.

A branch pushed by a session interrupted before its verification phase has never built. Expect to repair
it, and check before merging rather than after.

## A checkpoint push is rejected

The runner pushes the task's branch every fifteen turns, and one last time at the end of the session.
When the forge refuses, the trace carries a warning starting with
`checkpoint <repo> at turn <n>:`, keeping what git said that matters: the whole
`! [rejected] <branch> -> <branch> (<reason>)` line, the `error:` or `fatal:` lines, and the first
`hint:`. The remote address and the command run are left out, they teach nothing. The message is capped,
but if needed it is the start that gets cut, never the end, because git writes the reason last.

The reason in parentheses says what happened. `fetch first`, `non-fast-forward` or `stale info` mean the
remote branch moved on and the clone did not know. The usual case is an earlier session of the same task,
stopped while the next one was cloning, whose last push arrived after the clone. In that case the runner
does not loop: it runs `git fetch origin <branch>` then `git rebase FETCH_HEAD`, and pushes again, once.
If that works, a warning says so (`rebased onto it and pushed again`) and the checkpoint is reported as
successful. Rebase rather than merge, because a task's branch is linear and is read commit by commit in
its pull request; a merge commit made by a safety net would pass a checkpoint off as an integration.

If the rebase fails, it is a conflict: both sessions touched the same lines. The runner aborts the rebase
and puts the tree back as it was, so the agent finds a usable repository on the next turn. The warning
then says `the rebase onto it failed`, quotes git's reason, and ends with the move to make by hand: in a
clone of the branch, `git fetch origin <branch>`, `git rebase FETCH_HEAD`, resolve, then `git push`. The
next checkpoint retries on its own; until the conflict is resolved it will be rejected the same way, and
the session's work lives only in its container.

Any other reason is not rebased, because a rebase would not fix it. A
`remote: Permission to <repo> denied to <account>` followed by a `403` is a token without write access:
check the project secret and that it is ticked for this agent. A
`fatal: Could not read from remote repository` is an unreachable remote or an SSH key the forge does not
know, see "A clone fails". A protected branch is refused with `remote: error: GH006` and is fixed on the
forge side.

The end-of-session push follows the same rule. If it is refused after the rebase, the trace carries a
warning that triggers the notification, and a run error `final push of <repo> (<branch>) failed:` with
the same reason, which the task's verdict shows. The work is then at risk: it exists only in the
container, and the container dies with the session. Push it by hand while it is there, or run the task
again after fixing the cause.

## An agent invents an agent name

Names suggested by `propose_task` are checked against the project's real agents. An unknown name is
rejected, the task is proposed without an agent, and a warning lists the valid names.

## The session stops without a word, with an error code

Look at the trace: if it says the session was killed out of memory, the container exceeded its runner's
RAM limit and the kernel stopped the runtime. It is not a program error, and the automatic diagnostic
often gets it wrong: it sees the trace stop in the middle of a command and concludes that command hung.

The usual cause is an agent leaving several development servers running at once, Storybook with a driven
browser on top. Raise the memory per session on the runner's card in System → Runners, or ask the agent
to run one thing at a time.

Before 26 August, this failure only surfaced as "the agent process exited with code 1", with no other
clue.

## Re-checking the SSH fingerprints stamped into the session image

The image stamps the host keys of github.com and gitlab.com at `docker build` time (`ssh-keyscan`, see
`session-image/Dockerfile`) rather than discovering them in each session: trust on first contact, set
once, on the operator's machine, never inside a container. `ARG SSH_KNOWN_HOSTS_FP` pins the expected
ED25519 fingerprint of github.com; the build fails if `ssh-keyscan` returns another.

To redo the check (useful after a key rotation announced by a forge, or when in doubt):

1. Get the official fingerprints published by the forges, citing the exact URL:
   - GitHub: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
   - GitLab: https://docs.gitlab.com/user/gitlab_com/ (section "SSH host keys fingerprints")
2. Scan what the forges actually answer, then print the SHA256 fingerprints:
   ```
   ssh-keyscan -t rsa,ecdsa,ed25519 github.com gitlab.com > /tmp/known_hosts_scan.txt
   ssh-keygen -lf /tmp/known_hosts_scan.txt
   ```
3. Compare the six fingerprints (RSA/ECDSA/ED25519 × 2 hosts) line by line with the published ones. If
   everything matches, nothing to do. If one differs, do NOT rebuild the image before understanding why
   (officially announced key rotation, or a sign of interception): ask the operator rather than stamping
   an unconfirmed key.
4. If github.com's ED25519 fingerprint changed legitimately, update the default value of
   `ARG SSH_KNOWN_HOSTS_FP` in `session-image/Dockerfile` and rebuild (`make image-session`).

Never make up a fingerprint from memory or guesswork: if a source is unreachable, the check stops there
and reports itself as incomplete, it does not fill the gap with a plausible value.

## Updating Legion

The Version card, in System → General, compares the running version with the latest tag of the GitHub
repository. When a newer version exists and nothing prevents it, a button appears.

Three things prevent it, and the screen says which. Running sessions: the update restarts the control
plane for one to three minutes; containers survive, but lose their file, task and inbox tools meanwhile,
so the card offers to suspend them first. A working tree with uncommitted changes: moving over them would
overwrite them. A branch other than `main`: a click never leaves a working branch.

The button starts a script that survives the server, because the server is exactly what is being
replaced. It first copies the database to `data/backups/`, then fetches the tags, moves, reinstalls
dependencies and rebuilds the session image. Everything is written to `data/updates/`, with the exact
command to roll back.

Meanwhile the interface stops answering: that is normal, the control plane is restarting. Under
`make dev`, it comes back on its own. Under `pnpm start`, restart it by hand.

Migrations apply on the next start, and they have no way back. That is why copying the database is the
very first step, before even touching git. The full picture, container mode included, is in
[[guides/mettre-a-jour]].

## Setting a version

`VERSION=v0.5.0 make release` sets the tag and pushes it. It refuses a format other than `vX.Y.Z`, a tag
that already exists, and an uncommitted tree: a tag is a return point, and setting one on a state that
exists in no commit would lead nowhere.

## Read next

[[reference/statuts]], [[concepts/runner]], [[concepts/session]].
