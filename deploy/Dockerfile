# Legion control plane: one image serving the API and the screen from a single process.
#
# Built from the repository root, since the context is the whole monorepo:
#   docker compose -f deploy/compose.yaml build
#
# The same process serves `web/dist` (`server/src/http/static.ts`): one port, one origin, nothing to
# decide about CORS. An HTTPS front end may sit in front; nothing here depends on the caller's address.
#
# Two stages: `better-sqlite3` compiles (python3/make/g++, ~200 MB of tools) and the web build needs
# all the front end's devDependencies. The runtime stage keeps only node, the modules and the output.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# `better-sqlite3` has no prebuilt binary for every node/arch pair. Without these, `pnpm install`
# fails in `node-gyp` with a message about python rather than the real cause.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Same pnpm as the repository (`packageManager` in `package.json`), so the image resolves
# dependencies like the development machine.
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# Manifests before code: copying the repository before the install would re-download 700 MB of
# modules on every commit.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY . .
# The web `build` script is `tsc --noEmit && vite build`: a type error fails the image build instead
# of shipping a broken screen.
RUN pnpm --filter @legion/web build

FROM node:22-bookworm-slim
WORKDIR /app/server

# `openssh-client`: fleet runners are `ssh://` hosts and the docker CLI opens an SSH connection to
# reach them. Without the client every remote runner is unreachable and the probe marks it dead
# without saying why.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The docker CLI only: `shared/docker-exec.ts` runs the `docker` binary with `DOCKER_HOST` set, there
# is no HTTP client in the code. `compose.yaml` mounts the host socket, but only to start the
# ephemeral update container; sessions run on the declared runners and the local runner stays out
# of play. Pinned to the server daemon's major (Docker 28): an older client works against a newer
# daemon, not always the reverse.
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker

# The installed monorepo as is: modules, server, `web/dist`, and `docs/wiki`, which the wiki domain
# reads from disk (`server/src/wiki/wiki.ts` resolves the repository root from its own path).
# Copying more selectively would break the pnpm store's symlinks.
COPY --from=build /app /app

# No `git` in the image, on purpose since 01/09 (slice 08): the Version card must say what runs, not
# what is on the host's disk. A git reading the mounted clone would lie between a `git pull` and the
# rebuild that follows. The version is stamped below; `git pull` belongs to the ephemeral update
# container, which has its own git.

# Set by `deploy/up.sh`, read by `server/src/updates/stamp.ts`.
# After the `COPY` on purpose: an `ARG` invalidates its layer and every later one, and these values
# change on every commit, so placed higher they would rebuild `better-sqlite3` and the screen on
# every update.
# Empty by default: a manual `docker build` still works and the server says so (the `unstamped`
# blocker in `guards.ts`).
ARG GIT_DESCRIBE=""
ARG GIT_SHA=""
ARG GIT_BRANCH=""
ARG GIT_ORIGIN=""
ENV LEGION_GIT_DESCRIBE=$GIT_DESCRIBE \
    LEGION_GIT_SHA=$GIT_SHA \
    LEGION_GIT_BRANCH=$GIT_BRANCH \
    LEGION_GIT_ORIGIN=$GIT_ORIGIN

# The data directory is one volume, database included: all the state that outlives the image. The
# defaults (`legion.db` and `data/` relative to cwd) suit a development clone, not a disposable
# container filesystem.
ENV NODE_ENV=production \
    LEGION_DATA=/data \
    LEGION_DB=/data/legion.db \
    PORT=8790
EXPOSE 8790

# What `pnpm start` runs (`tsx src/index.ts`), without shipping pnpm in the runtime stage. The server
# is PID 1, so a `docker stop` actually reaches it.
CMD ["node", "--import", "tsx", "src/index.ts"]
