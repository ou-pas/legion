# Legion browser image: the shared browser service (one container per runner, v30).
# The pinned official Playwright base ships the browsers and their system dependencies. The npm
# `playwright` package (same version) is installed at build time too: the container sits on an
# `--internal` docker network with no egress, so nothing can be downloaded at startup. That is
# why the documented `npx -y playwright` on the bare official image is not an option here.
#
# The version must match playwright-core in session-image/Dockerfile and web/package.json:
# Playwright's `connect()` rejects a client/server version gap.
# `server/src/infra/browser-version.test.ts` fails if they diverge; it would have caught the
# drift to 1.49.1 while the repo was on 1.62.1 (task zsqFzAcMxG, 26/08 then 03/09).
# Build from repo root:  make image
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /opt/browser
RUN npm init -y > /dev/null && npm install playwright@1.62.1 > /dev/null

# Non-root user provided by the official image.
USER pwuser
EXPOSE 3000
CMD ["npx", "playwright", "run-server", "--port", "3000", "--host", "0.0.0.0"]
