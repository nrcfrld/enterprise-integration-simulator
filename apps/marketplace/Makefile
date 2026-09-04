# Marketplace development shortcuts. Run these commands from apps/marketplace.

ROOT_DIR := $(abspath ../..)
COMPOSE := docker compose -f $(ROOT_DIR)/docker-compose.yml
GO_FILES = $$(find . -type f -name '*.go' -not -path './admin/*')
GO_PACKAGES = $$(go list ./... | grep -v '/admin/node_modules/')
CORE_PACKAGES = ./internal/auth ./internal/events ./internal/idempotency ./internal/inventory ./internal/orders ./internal/products ./internal/ratelimit ./internal/scenarios ./internal/tokopedia ./internal/webhooks
CORE_COVERAGE_MIN ?= 80
CORE_COVERAGE_FILE ?= /tmp/marketplace-core-coverage.out
ADMIN_COVERAGE_MIN ?= 60
GOVULNCHECK_VERSION ?= v1.7.0
ADMIN_DIR := admin

.DEFAULT_GOAL := help
.PHONY: help generate generate-check fmt fmt-check vet vuln lint lint-full test test-fast test-unit test-race test-integration coverage-core \
	admin-test admin-coverage admin-lint admin-build test-all lint-all check \
	docker-build docker-build-api docker-build-worker docker-build-admin \
	compose-build compose-up compose-down compose-logs compose-ps

help: ## Show every available command.
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*##/ {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

generate: ## Regenerate OpenAPI and sqlc code.
	go generate ./internal/api/openapi ./internal/store

generate-check: generate ## Fail when committed OpenAPI or sqlc bindings are stale.
	@drift="$$(git status --porcelain -- internal/api/openapi internal/store/sqlc)"; \
	if [ -n "$$drift" ]; then \
		echo "Generated bindings are stale:"; echo "$$drift"; git diff -- internal/api/openapi internal/store/sqlc; exit 1; \
	fi

fmt: ## Format all Go source files.
	gofmt -w $(GO_FILES)

fmt-check: ## Fail when Go source files are not gofmt-formatted.
	@unformatted="$$(gofmt -l $(GO_FILES))"; \
	if [ -n "$$unformatted" ]; then \
		echo "Run 'make fmt' to format:"; echo "$$unformatted"; exit 1; \
	fi

vet: ## Run Go's static analyzer.
	go vet $(GO_PACKAGES)

vuln: ## Scan reachable Go vulnerabilities with a pinned scanner.
	go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) $(GO_PACKAGES)

lint: fmt-check vet ## Run formatting and Go static checks.

lint-full: lint ## Run golangci-lint too (requires golangci-lint on PATH).
	@command -v golangci-lint >/dev/null 2>&1 || { \
		echo "golangci-lint is not installed. Install it, then rerun make lint-full."; exit 1; \
	}
	golangci-lint run ./...

test-unit: ## Run Go unit and package tests.
	go test $(GO_PACKAGES)

coverage-core: ## Enforce at least 80% statement coverage per core package and in aggregate.
	go test $(CORE_PACKAGES) -covermode=atomic -coverprofile=$(CORE_COVERAGE_FILE)
	@awk -v minimum="$(CORE_COVERAGE_MIN)" 'NR > 1 { \
		split($$1, location, ":"); package = location[1]; sub("/[^/]+$$", "", package); \
		total[package] += $$2; if ($$3 > 0) covered[package] += $$2 \
	} END { \
		failed = 0; \
		for (package in total) { \
			coverage = 100 * covered[package] / total[package]; display = package; sub("^.*/internal/", "internal/", display); \
			if (coverage + 0 < minimum + 0) { printf "%s coverage %.1f%% is below %.1f%%\n", display, coverage, minimum; failed = 1 } \
			else { printf "%s coverage %.1f%% meets %.1f%% minimum\n", display, coverage, minimum } \
		} \
		exit failed \
	}' $(CORE_COVERAGE_FILE)
	@coverage="$$(go tool cover -func=$(CORE_COVERAGE_FILE) | awk '/^total:/ {gsub(/%/, "", $$3); print $$3}')"; \
	awk -v coverage="$$coverage" -v minimum="$(CORE_COVERAGE_MIN)" 'BEGIN { if (coverage + 0 < minimum + 0) { printf "Core coverage %.1f%% is below %.1f%%\n", coverage, minimum; exit 1 } printf "Core coverage %.1f%% meets %.1f%% minimum\n", coverage, minimum }'

test-fast: test-unit admin-test ## Run fast backend and Admin UI tests (no containers).

test: test-fast test-integration ## Run the complete test suite, including Testcontainers.

test-race: ## Run race detection for the backend test suite.
	go test -race $(GO_PACKAGES)

test-integration: ## Run PostgreSQL/Redis integration tests using Testcontainers.
	go test -race -count=1 -tags=testcontainers ./integration ./cmd/worker -v

admin-test: ## Run Admin UI tests.
	bun run --cwd $(ADMIN_DIR) test

admin-coverage: ## Run Admin UI tests and enforce the configured coverage minimum.
	ADMIN_COVERAGE_MIN=$(ADMIN_COVERAGE_MIN) bun run --cwd $(ADMIN_DIR) test:coverage

admin-lint: ## Lint and type-check the Admin UI.
	bun run --cwd $(ADMIN_DIR) lint
	bun run --cwd $(ADMIN_DIR) typecheck

admin-build: ## Build the Admin UI production bundle.
	bun run --cwd $(ADMIN_DIR) build

test-all: test ## Alias for the complete test suite.

lint-all: lint admin-lint ## Run backend and Admin UI checks.

check: generate-check lint-full vuln admin-lint test admin-coverage admin-build coverage-core ## Run the complete local quality gate.

docker-build: docker-build-api docker-build-worker docker-build-admin ## Build all local Docker images.

docker-build-api: ## Build the Marketplace API image.
	docker build --target api --tag marketplace-api:local --file $(ROOT_DIR)/apps/marketplace/Dockerfile $(ROOT_DIR)

docker-build-worker: ## Build the Marketplace worker image.
	docker build --target worker --tag marketplace-worker:local --file $(ROOT_DIR)/apps/marketplace/Dockerfile $(ROOT_DIR)

docker-build-admin: ## Build the Marketplace Admin image.
	docker build --tag marketplace-admin:local $(ROOT_DIR)/apps/marketplace/admin

compose-build: ## Build images declared in Docker Compose.
	$(COMPOSE) build

compose-up: ## Start the full local stack in the background.
	$(COMPOSE) up --detach --build

compose-down: ## Stop the local stack (keeps the database volume).
	$(COMPOSE) down

compose-logs: ## Follow local stack logs.
	$(COMPOSE) logs --follow

compose-ps: ## Show local stack status.
	$(COMPOSE) ps
