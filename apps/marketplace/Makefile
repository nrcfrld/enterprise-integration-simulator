# Marketplace development shortcuts. Run these commands from apps/marketplace.

ROOT_DIR := $(abspath ../..)
COMPOSE := docker compose -f $(ROOT_DIR)/docker-compose.yml
GO_FILES = $$(find . -type f -name '*.go' -not -path './admin/*')
GO_PACKAGES = $$(go list ./... | grep -v '/admin/node_modules/')
ADMIN_DIR := admin

.DEFAULT_GOAL := help
.PHONY: help generate fmt fmt-check vet lint lint-full test test-fast test-unit test-race test-integration \
	admin-test admin-lint admin-build test-all lint-all check \
	docker-build docker-build-api docker-build-worker docker-build-admin \
	compose-build compose-up compose-down compose-logs compose-ps

help: ## Show every available command.
	@awk 'BEGIN {FS = ":.*##"}; /^[a-zA-Z0-9_-]+:.*##/ {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

generate: ## Regenerate OpenAPI and sqlc code.
	go generate ./internal/api/openapi ./internal/store

fmt: ## Format all Go source files.
	gofmt -w $(GO_FILES)

fmt-check: ## Fail when Go source files are not gofmt-formatted.
	@unformatted="$$(gofmt -l $(GO_FILES))"; \
	if [ -n "$$unformatted" ]; then \
		echo "Run 'make fmt' to format:"; echo "$$unformatted"; exit 1; \
	fi

vet: ## Run Go's static analyzer.
	go vet $(GO_PACKAGES)

lint: fmt-check vet ## Run formatting and Go static checks.

lint-full: lint ## Run golangci-lint too (requires golangci-lint on PATH).
	@command -v golangci-lint >/dev/null 2>&1 || { \
		echo "golangci-lint is not installed. Install it, then rerun make lint-full."; exit 1; \
	}
	golangci-lint run ./...

test-unit: ## Run Go unit and package tests.
	go test $(GO_PACKAGES)

test-fast: test-unit admin-test ## Run fast backend and Admin UI tests (no containers).

test: test-fast test-integration ## Run the complete test suite, including Testcontainers.

test-race: ## Run race detection for the backend test suite.
	go test -race $(GO_PACKAGES)

test-integration: ## Run PostgreSQL/Redis integration tests using Testcontainers.
	go test -race -count=1 -tags=testcontainers ./integration ./cmd/worker -v

admin-test: ## Run Admin UI tests.
	bun --cwd $(ADMIN_DIR) test

admin-lint: ## Lint and type-check the Admin UI.
	bun --cwd $(ADMIN_DIR) run lint
	bun --cwd $(ADMIN_DIR) run typecheck

admin-build: ## Build the Admin UI production bundle.
	bun --cwd $(ADMIN_DIR) run build

test-all: test ## Alias for the complete test suite.

lint-all: lint admin-lint ## Run backend and Admin UI checks.

check: lint-all test ## Run the complete local quality gate.

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
