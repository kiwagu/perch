# Project rules

All project rules live in `.cursor/rules/`, the single source for every agent.
The references below are a reading list: before changing code, read each rule
that applies to the task, starting with the router.

## Router and gates

@.cursor/rules/process-check-rules-skills.mdc
@.cursor/rules/reuse-first-discovery.mdc
@.cursor/rules/security-review-before-commit.mdc
@.cursor/rules/verify-before-commit-and-landing.mdc

## Always-on conventions

@.cursor/rules/static-imports-only.mdc
@.cursor/rules/no-any.mdc
@.cursor/rules/poc-no-fallbacks.mdc
@.cursor/rules/reset-mode-default.mdc
@.cursor/rules/entity-first-module-naming.mdc
@.cursor/rules/package-readme.mdc

## Architecture and contracts

@.cursor/rules/domain-context-first-analysis.mdc
@.cursor/rules/zod-schema-first-contracts.mdc
@.cursor/rules/monorepo-env-minimalism.mdc

## User interface

@.cursor/rules/ui-primitive-hygiene.mdc
@.cursor/rules/ui-i18n-direct-keys.mdc

## Vendor skills

Pinned in `skills-lock.json`, installed under `.agents/skills/`: `shadcn`,
`surrealql`, `surrealql-functions`, `surrealkit`, `surrealdb-js`, `surrealdb-cli`.
Restore them with `bunx skills experimental_install`.
