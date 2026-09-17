# Legion — single entry point. `make` or `make help` lists everything.
.DEFAULT_GOAL := help
SHELL := /bin/bash

# `scripts/*.ts` (batch 1, 09/09): TypeScript run as is through the `tsx` Node loader, no build step,
# as `pnpm --filter @legion/server test` already does. `tsx` is a root dev dependency.
NODE_TSX := node --import tsx

.PHONY: install
install: ## Install dependencies (server + web workspaces)
	pnpm install

.PHONY: env
env: ## Create server/.env from the example if missing
	@test -f server/.env && echo "server/.env already exists" || (cp server/.env.example server/.env && echo "server/.env created: set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in it")

# Three images, and only one depends on the work being shipped. Built together, a payload change also
# rebuilt the browser, whose base is `mcr.microsoft.com/playwright:v1.62.1-noble` (browser-image/
# Dockerfile; this tag must follow playwright-core in web/package.json, see
# server/src/infra/browser-version.test.ts): several gigabytes plus an `npm install playwright` that
# re-downloads its binaries (operator feedback, 26/08).
#
# After a batch touching `runner-payload/`: `make image-session`, nothing else.
#
# `image-browser` and `image-proxy` cost nothing when nothing changed (03/09): they compare their
# context folder's hash with the `legion.context-hash` label on the targeted daemon's image
# (`scripts/fleet-image.sh` explains the criterion). That lets the update replay them on every runner
# (`server/src/updates/docker-update.ts`); until 03/09 it replayed only `image-session`, so a merged
# browser fix never deployed.
#
# `make image` is what installation runs. `FLEET_IMAGE_FORCE=1` rebuilds without checking the label.

.PHONY: image
image: image-session image-proxy image-browser ## Build all THREE images (installation)

.PHONY: image-session
image-session: ## Session image ONLY, the one that depends on the payload
	@# The folder, not a list (06/09). Ten hand-written paths lived here and in four other places; on
	@# 04/09 `turn-outcome.mjs` was in none of them and the whole fleet went down, four tasks dead
	@# with `exit 1` before their first `report`. `runner-payload/` holds only the payload.
	@# The payload is compiled in the Dockerfile since 13/09. Compiling here needed pnpm and an
	@# installed repository on the building machine, while the fleet rebuild container only has
	@# docker and the control plane's server has neither node nor pnpm: rebuilds failed on all three
	@# runners with `make: pnpm: No such file or directory`. This recipe now only hashes and builds.
	@# The context is the root because `tsc` needs `runner-payload/`; `session-image/
	@# Dockerfile.dockerignore` narrows it to two folders, and BuildKit reads it before the root one.
	@# The hash covers every payload source, not only session-runner.mts: otherwise changing
	@# stuck.mts never marked the image stale and sessions ran a detector three versions old.
	@# Same scheme as currentPayloadHash() in server/src/infra/fleet-images.ts: sha256 of the list
	@# of per-file sha256, one per line. `LC_ALL=C sort` fixes the order, part of the scheme: glob
	@# expansion depends on the shell's locale, `Array.sort()` compares code units.
	@# Sources (`*.mts`), not compiled `.mjs`: a batch changes the source. `payloadFiles()` reads
	@# the same pattern.
	@HASH=$$( ls runner-payload/*.mts | LC_ALL=C sort | while read -r f; do \
	    (shasum -a 256 $$f 2>/dev/null || sha256sum $$f) | cut -d' ' -f1; \
	  done | (shasum -a 256 2>/dev/null || sha256sum) | cut -d' ' -f1 ); \
	test -n "$$HASH" || { echo "payload hash not computed (shasum/sha256sum missing?)"; exit 1; }; \
	docker build -t legion-session:latest --label legion.payload-hash=$$HASH -f session-image/Dockerfile .

.PHONY: image-proxy
image-proxy: ## Egress proxy (alpine + tinyproxy), rebuilt ONLY if proxy-image/ changed
	@sh scripts/fleet-image.sh build legion-proxy:latest proxy-image

.PHONY: image-browser
image-browser: ## Shared browser (Playwright base, several GB), rebuilt ONLY if browser-image/ changed
	@# The second label names the drift instead of noticing it: a hash says there is one,
	@# "1.49.1 against 1.62.1" says which, and that is the only reason `chromium.connect()` refuses
	@# the handshake. Read by the Infra screen through `GET /api/infra`.
	@sh scripts/fleet-image.sh build legion-browser:latest browser-image \
	  --label legion.playwright-version=$$(sh scripts/fleet-image.sh playwright-version browser-image/Dockerfile)

.PHONY: setup
setup: install env image ## All in one: install + env + image

.PHONY: release
release: ## Tag the current version and push it: VERSION=v0.5.0 make release
	@test -n "$(VERSION)" || { echo "⛔ VERSION missing: VERSION=v0.5.0 make release" >&2; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$$' \
		|| { echo "⛔ \"$(VERSION)\" is not a version: vX.Y.Z, optionally followed by a dash suffix." >&2; exit 1; }
	@# A tag is a rollback point: on a dirty tree it would name a state that exists in no commit.
	@git diff --quiet && git diff --cached --quiet \
		|| { echo "⛔ Working tree not clean: commit before tagging." >&2; exit 1; }
	@git rev-parse -q --verify "refs/tags/$(VERSION)" >/dev/null \
		&& { echo "⛔ Tag $(VERSION) already exists." >&2; exit 1; } || true
	git tag -a "$(VERSION)" -m "$(VERSION)"
	git push origin "$(VERSION)"
	@echo "→ $(VERSION) pushed. Other machines will see it in /infra."

.PHONY: operator-token
operator-token: ## Reset an operator token and print it: RUN ON THE CONTROL PLANE MACHINE
	@node server/scripts/operator-token.mjs

.PHONY: dev
dev: ## Run server (:8790) + UI (:5173) + Storybook workshop (:6006) in watch mode
	pnpm dev

.PHONY: server
server: ## Run the control plane only (:8790)
	pnpm dev:server

.PHONY: web
web: ## Run the UI only (:5173)
	pnpm dev:web

.PHONY: ds
ds: ## Run the design system workshop only (Storybook, :6006)
	pnpm --filter @legion/web ds

.PHONY: mock
mock: ## Run in mock/process mode: no Docker or credentials (UI development)
	LEGION_RUNNER=process pnpm dev

.PHONY: typecheck
typecheck: ## Check types (server + web)
	pnpm typecheck

.PHONY: fresh
fresh: ## Is the branch up to date with origin/main? FIRST gate of `gates` (scripts/fresh-check.ts says why)
	@$(NODE_TSX) scripts/fresh-check.ts

.PHONY: gates
gates: ## The gates of `main`: freshness + format + lint + types + boundaries + dead code + audit + tests + contracts + UI
	@# First, not last (08/09): a branch green on an old `main` can be red on the new one. It happened
	@# four times on 08/09, each time after the whole suite had run for nothing.
	@echo "→ freshness" && $(NODE_TSX) scripts/fresh-check.ts
	@# Formatter before linter (09/09): `oxfmt` owns layout, `oxlint` meaning. The other order let
	@# the 499 files in `{return x;}` through on 09/09: the `curly` autofix ran with no formatter after.
	@echo "→ format"    && pnpm -s format:check
	@echo "→ lint"      && pnpm -s lint
	@echo "→ types"     && pnpm -s typecheck
	@# The architecture harness gates (05/09) sit between types and tests: a few seconds, answering
	@# before three minutes of tests, since a crossed boundary or dead export shows on the import graph.
	@echo "→ boundaries" && $(NODE_TSX) scripts/arch-check.ts
	@echo "→ dead code"  && $(NODE_TSX) scripts/deadcode-check.ts
	@echo "→ deps audit" && $(MAKE) --no-print-directory audit-deps
	@# `pnpm test` also carries the server coverage thresholds (80 lines / 75 branches / 75
	@# functions). The `dot` reporter prints nothing when coverage is what fails, the process just
	@# exits 1, so this message says which of the two causes it was.
	@echo "→ tests"     && { pnpm -s test || { \
		echo "⛔ tests red OR server coverage under thresholds (80/75/75)."; \
		echo "   \`make coverage-report\` prints the per-file table and tells the two apart."; \
		exit 1; }; }
	@echo "→ contract"  && $(NODE_TSX) scripts/api-contract.ts
	@echo "→ web build" && pnpm -s --filter @legion/web build >/dev/null
	@# The stories gate is in `pnpm test` since 09/09 (`web/src/stories.test.tsx`), no longer a
	@# target of its own: it opened every story in real Chrome, six minutes for a DOM node count
	@# jsdom gives in 1.5 s, and it now runs in CI too.
	@echo "✓ gates green"

.PHONY: contract
contract: ## What the screen calls vs what the server serves: the contract no compiler reads
	@$(NODE_TSX) scripts/api-contract.ts

# Architecture harness (05/09). What CLAUDE.md and DESIGN.md promised since batches 40-41 was a prompt
# rule, a request an agent reads or not; these targets make them gates. Same model as `make contract`:
# known debt is declared in a baseline with the work that settles it, new debt fails, and a stale
# declaration fails too so the list shrinks.

.PHONY: arch
arch: ## Boundaries between contexts: what imports what, against scripts/arch-deps-baseline.json
	@$(NODE_TSX) scripts/arch-check.ts

.PHONY: arch-baseline
arch-baseline: ## Rewrite scripts/arch-deps-baseline.json: ONLY for debt added on purpose and named
	@$(NODE_TSX) scripts/arch-check.ts --write

.PHONY: arch-metrics-baseline
arch-metrics-baseline: ## Rewrite scripts/arch-metrics-baseline.json (the AST ratchet of server/src/architecture): same rule as arch-baseline
	@$(NODE_TSX) scripts/arch-metrics.ts --write-baseline

.PHONY: arch-metrics
arch-metrics: ## The AST ratchet's measures, readable, without the verdict `pnpm test` gives
	@$(NODE_TSX) scripts/arch-metrics.ts --pretty

.PHONY: deadcode
deadcode: ## What nobody imports any more, against scripts/deadcode-baseline.json
	@$(NODE_TSX) scripts/deadcode-check.ts

.PHONY: deadcode-baseline
deadcode-baseline: ## Rewrite scripts/deadcode-baseline.json: same rule as arch-baseline
	@$(NODE_TSX) scripts/deadcode-check.ts --write

.PHONY: deadcode-report
deadcode-report: ## The raw knip report, without the ratchet: what is dead and why
	@npx knip --reporter compact || true

# Mutation testing (Stryker) lives in its own file: not a gate, a measure run domain by domain; the
# header of Makefile.stryker says why.
include Makefile.stryker

.PHONY: audit-deps
audit-deps: ## "high" security advisories on PRODUCTION dependencies
	@pnpm audit --prod --audit-level=high

.PHONY: coverage-report
coverage-report: ## Server coverage table, file by file (the thresholds live in `pnpm test`)
	@cd server && node --import tsx --test --test-reporter=spec --experimental-test-coverage \
		--test-coverage-exclude='**/*.test.ts' --test-coverage-exclude='**/migrations/**' \
		"src/**/*.test.ts" 2>&1 | grep -E "^ℹ" || true

.PHONY: doc-contract
doc-contract: ## What the code does vs what the docs say: every domain knows where it is described
	@$(NODE_TSX) scripts/doc-contract.ts

.PHONY: build
build: ## Production build of the UI
	pnpm --filter @legion/web build

.PHONY: ds-build
ds-build: ## Build the workshop statically (storybook-static/): compiles EVERY story
	pnpm --filter @legion/web ds:build

responsive: ## Measure triage screens at 375x812 (iPhone 13 mini): `make dev` must run, LEGION_TOKEN=… required
	@echo "→ compact breakpoint (DESIGN.md § Width)"
	@node web/scripts/measure-compact.mjs

.PHONY: db-reset
db-reset: ## Delete the SQLite database (re-seeded at next startup)
	rm -f server/legion.db server/legion.db-wal server/legion.db-shm
	@echo "Database deleted: it will be recreated and seeded at next startup."

.PHONY: adopt-tokens
adopt-tokens: ## Ask providers what they know about never-probed tokens (pasted AND granted): repeatable, destroys nothing
	@# Not a migration: migrations run at startup and this depends on the network. An instance
	@# booting while GitHub is unreachable must not stop for a display enrichment.
	@node --import tsx server/scripts/adopt-pasted-tokens.ts

.PHONY: network-audit
network-audit: ## Who is walled off, who carries which secrets, and what would break (read-only)
	node --import tsx server/scripts/network-audit.ts

.PHONY: sessions-clean
sessions-clean: ## Remove session leftovers: containers, egress proxies and networks
	@# Three name families, all derived from the session id (runner/docker.ts): legion-session-<id>,
	@# legion-proxy-<id>, and the legion-net-<id> network. This target used to clean only one; the
	@# proxy exists only for a walled-off agent, so it piled up unseen, and on 25/08 a leftover
	@# proxy killed a session's resume on wake-up: its name was taken.
	@#
	@# The shared browser (legion-browser-<runner>, legion-browser-net-<runner>) is not a leftover:
	@# it lives between sessions. Docker filters match a substring, and "legion-net-" does not occur
	@# in "legion-browser-net-", which is what makes these filters safe; do not widen them.
	@#
	@# No `xargs -r`: it is GNU-only and macOS xargs refuses it. The explicit guard works everywhere.
	@ids=$$(docker ps -a --filter "name=legion-session-" -q); [ -z "$$ids" ] || docker rm -f $$ids
	@ids=$$(docker ps -a --filter "name=legion-proxy-" -q); [ -z "$$ids" ] || docker rm -f $$ids
	@nets=$$(docker network ls --filter "name=legion-net-" -q); [ -z "$$nets" ] || docker network rm $$nets
	@echo "Session leftovers cleaned: the shared browser is kept."

.PHONY: clean
clean: sessions-clean ## Full cleanup: containers + node_modules + builds
	rm -rf node_modules server/node_modules web/node_modules web/dist

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "  Legion — available targets:"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  First run:  make setup && make dev"
	@echo ""
