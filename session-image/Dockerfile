# Legion session image — one throwaway container per session.
# Build from repo root:  make image-session

# Payload compilation stage (13/09).
#
# The payload has been TypeScript since batch 10 and was compiled by the Makefile recipe, so the
# building machine needed pnpm and an installed repository. The container that rebuilds fleet images
# is a `docker:28-cli` with only docker, and the control plane's server has neither node nor pnpm:
# "Rebuild here" and fleet updates failed on all three runners with
#
#     make: pnpm: No such file or directory
#     make: *** [Makefile:62: image-session] Error 127
#
# and the only suggested way out needed a development machine. Now building needs only docker.
#
# Dependencies are installed twice on purpose: this stage resolves them to typecheck, the final stage
# reinstalls them to run, and neither set (TypeScript included) reaches the session image. Each
# install has its own cache layer, invalidated only by the payload's `package.json`.
#
# `--outDir` on the command line rather than in the tsconfig, which writes to `../session-image`: the
# right path when `tsc` runs from the repository, meaningless here. The tsconfig stays the single
# source for everything else (target, resolution, `noEmitOnError`).
FROM node:22-slim AS payload
WORKDIR /payload
COPY runner-payload/package.json runner-payload/tsconfig.json ./
RUN npm install --no-audit --no-fund --loglevel=error
COPY runner-payload/*.mts ./
RUN npx tsc --outDir /payload/out

FROM node:22-slim

# `make`: the Makefile is versioned and agents are told to use its targets, but node:22-slim ships no
# build tool, so an agent read an instruction it could not follow. 300 kB.
#
# `openssh-client` + `netcat-openbsd` (v40): git over SSH. netcat carries the `ProxyCommand` when the
# session runs behind the egress proxy (`nc -X connect`, which GNU netcat cannot do). Both are inert
# until a project declares a key.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates make openssh-client netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Server fingerprints are baked in at build time, not discovered per session.
#
# These are not secrets: the public host keys of github.com and gitlab.com, used to recognise the
# server. The operator's private key never enters the image; it is mounted read-only at launch and
# dies with the container.
#
# The alternative, `StrictHostKeyChecking=accept-new`, trusts the first server that answers, on every
# session, from a container, on a network we do not control. Trust is placed once, on the operator's
# machine, when the image is built.
#
# `ssh-keygen -lf` prints the fingerprints in the build log: compare them with what the forge
# publishes (GitHub: "GitHub's SSH key fingerprints"). It is the only moment a human can check.
#
# To pin instead of checking by eye:
#   docker build --build-arg SSH_KNOWN_HOSTS_FP=SHA256:… -t legion-session:latest session-image
# The build fails if the expected fingerprint is not among those received.
# `--build-arg SSH_KNOWN_HOSTS=` (empty) builds an image with no fingerprint; the `known_hosts`
# mounted from the operator's machine then does all the work.
ARG SSH_KNOWN_HOSTS="github.com gitlab.com"
ARG SSH_KNOWN_HOSTS_FP=""
RUN if [ -n "$SSH_KNOWN_HOSTS" ]; then \
      ssh-keyscan -t rsa,ecdsa,ed25519 $SSH_KNOWN_HOSTS > /etc/ssh/ssh_known_hosts 2>/dev/null; \
      test -s /etc/ssh/ssh_known_hosts || { echo "ssh-keyscan returned nothing for: $SSH_KNOWN_HOSTS"; exit 1; }; \
      chmod 644 /etc/ssh/ssh_known_hosts; \
      echo "[image] server fingerprints baked in, CHECK THEM:"; \
      ssh-keygen -lf /etc/ssh/ssh_known_hosts; \
      if [ -n "$SSH_KNOWN_HOSTS_FP" ]; then \
        ssh-keygen -lf /etc/ssh/ssh_known_hosts | grep -qF "$SSH_KNOWN_HOSTS_FP" \
          || { echo "expected fingerprint missing: $SSH_KNOWN_HOSTS_FP"; exit 1; }; \
      fi; \
    fi

WORKDIR /opt/legion
# undici: explicit ProxyAgent so control-plane callbacks work inside "limited" networks.
# playwright-core (v30): client of the shared browser, no binaries, just the
# `chromium.connect(BROWSER_WS_ENDPOINT)` protocol. Pinned to the server's version
# (browser-image/Dockerfile) and to web/package.json: connect() refuses a version mismatch.
# `server/src/infra/browser-version.test.ts` fails if they diverge.
RUN npm init -y > /dev/null \
  && npm install @anthropic-ai/claude-agent-sdk@^0.3.234 zod@^4.0.0 undici@^7.0.0 playwright-core@1.62.1 > /dev/null

# Everything that does not read the payload goes above the `COPY` lines. Docker invalidates a layer
# and every later one: `corepack prepare` and `useradd` used to sit below them, so each payload
# change re-downloaded pnpm (operator feedback, 26/08). A line that reads the payload goes below and
# costs on every batch. `infra.test.ts` enforces it.

# pnpm via corepack: without it no test command of a pnpm monorepo runs in a session, which kept
# Legion from working on Legion. Enabled as root so the shims land in /usr/local/bin.
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# /pkg-cache: the shared package cache (D14 of /artifacts/rtQLldYSm2/spec.md). The pnpm store used to
# live in `agent`'s HOME, inside the container, so every `pnpm install` re-downloaded everything,
# even across a long series of sessions on the same repository.
#
# The control plane mounts a host directory on /pkg-cache. Without a mount the directory still
# exists and the session uses it locally: the cache speeds things up, it is never a dependency.
#
# The pnpm store moves through a symlink because that is the only lever that works, checked on pnpm
# 11.22: `npm_config_store_dir`, `NPM_CONFIG_STORE_DIR`, `PNPM_STORE_DIR` and `store-dir` in
# `~/.npmrc` all leave `pnpm store path` on the default and silently fill the HOME store.
# `XDG_DATA_HOME` would also redirect every other XDG-aware tool to a directory shared between
# sessions; the link moves only the store. `npm_config_cache`, on the other hand, does work for npm.
#
# `safe.directory = *`: without it no real session gets past the clone (30/08). `/workspace` is a
# bind mount, so its files carry the host's uid while the container runs as `agent`; git refuses
# with "detected dubious ownership" and the session dies six seconds in. git's check stops a
# repository dropped by someone else from running hooks under your account; here all of
# `/workspace` comes from the operator, in a throwaway container, so it protects nothing. Same family
# as the SSH key the entrypoint copies to 0600. Written to the file rather than with
# `git config --global`, which at this point would target root's HOME.
RUN useradd -m agent && mkdir -p /workspace /claude-state /pkg-cache/pnpm-store /pkg-cache/npm \
  && mkdir -p /home/agent/.local/share/pnpm \
  && ln -s /pkg-cache/pnpm-store /home/agent/.local/share/pnpm/store \
  && printf '[safe]\n\tdirectory = *\n' > /home/agent/.gitconfig \
  && chown -R agent:agent /workspace /opt/legion /claude-state /pkg-cache /home/agent

# The whole compiled payload in one COPY (06/09). There were ten `COPY` lines, one per module, and
# five hand-kept lists describing one folder: on 04/09 `turn-outcome.mjs` was imported but not
# shipped and four tasks died with `exit 1` before their first `report`. A module imported but not
# copied breaks nothing locally, only in the container. Adding a module now needs nothing anywhere.
COPY --from=payload /payload/out/*.mjs /opt/legion/

# The entrypoint does not read the payload, but moving it above would gain nothing: it changes even
# less often.
COPY session-image/entrypoint.sh /opt/legion/entrypoint.sh

USER agent
ENV LEGION_WORKDIR=/workspace
ENV NODE_PATH=/opt/legion/node_modules
ENV npm_config_cache=/pkg-cache/npm
# A project wiring Vitest browser mode to the shared browser (BROWSER_WS_ENDPOINT, see
# docs/wiki/guides) needs the `playwright` npm package as a peer of `@vitest/browser-playwright`,
# even in connect-only mode where no local browser ever launches. Without this flag its postinstall
# tries to download Chromium on every `pnpm install`, which stalls or fails behind a "limited"
# network's allowlist. No browser is installed by this image (task 8jZtM1gy9n): the flag only
# stops one that was never needed.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /workspace

# The entrypoint prepares the SSH key when there is one, then `exec "$@"`, so the CMD stays
# overridable: `docker run … legion-session sh` still opens a shell for diagnosis.
# Invoked through `sh`, not its executable bit: a `RUN chmod` here would replay on every batch
# (`infra.test.ts` forbids it), and the bit carried by git is lost silently by the first careless
# copy, taking every session's startup with it.
ENTRYPOINT ["/bin/sh", "/opt/legion/entrypoint.sh"]
CMD ["node", "/opt/legion/session-runner.mjs"]
