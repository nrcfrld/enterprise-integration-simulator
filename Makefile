# Repository-level wrapper for the Marketplace development commands.

MARKETPLACE_DIR := apps/marketplace

.DEFAULT_GOAL := help
.PHONY: help generate fmt fmt-check vet lint lint-full test test-fast test-unit test-race test-integration coverage-core \
	admin-test admin-lint admin-build test-all lint-all check \
	docker-build docker-build-api docker-build-worker docker-build-admin \
	compose-build compose-up compose-down compose-logs compose-ps

help:
	@$(MAKE) --no-print-directory -C $(MARKETPLACE_DIR) help

generate fmt fmt-check vet lint lint-full test test-fast test-unit test-race test-integration coverage-core \
admin-test admin-lint admin-build test-all lint-all check \
docker-build docker-build-api docker-build-worker docker-build-admin \
compose-build compose-up compose-down compose-logs compose-ps:
	@$(MAKE) --no-print-directory -C $(MARKETPLACE_DIR) $@
