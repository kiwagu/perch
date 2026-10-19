# Agent context smoke test

Run through this table after editing a rule in `.cursor/rules/` or a vendor
skill, to confirm that prompts still route to the narrowest relevant document.

## How to use

1. Start from `.cursor/rules/process-check-rules-skills.mdc`.
2. For each prompt, check the first choice the router makes and the final document read.
3. When an agent loads broad neighbouring rules instead of the listed leaf, tighten the
   `description`, `Use This When` or `Descend To` text of the rules involved.

## Routing cases

| Prompt | Expected route |
| --- | --- |
| Add a helper that formats a user's display name | process -> reuse-first-discovery |
| Decide whether a profile rule belongs in the entity or in the service | process -> domain-context-first-analysis |
| Validate the parameters of a new command | process -> zod-schema-first-contracts |
| Read a JSON value from local storage and use its fields | process -> no-any, then zod-schema-first-contracts |
| Add a "Saved" notice to the profile page | process -> ui-i18n-direct-keys |
| Add a delete button with a confirmation menu | process -> ui-primitive-hygiene -> shadcn skill |
| Load the Spanish catalog only when the user picks Spanish | process -> static-imports-only |
| Make the database port configurable per machine | process -> monorepo-env-minimalism |
| Keep the old profile table working while adding the new one | process -> reset-mode-default, poc-no-fallbacks |
| Name the files of a new settings page | process -> entity-first-module-naming |
| Add a new workspace package for the gateway | process -> package-readme |
| Add a feature module with a new page | process -> package-readme |
| Add a handler to a 450-line service | process -> file-size-tiers |
| Add a second validation function to a domain entity file | process -> one-unit-per-file |
| Add a field to the profile table and expose it in a shape | process -> surrealql skill, then domain-context-first-analysis |
| Write a permission test for the new table | process -> surrealkit skill |
| Commit a change to the access method | process -> security-review-before-commit |
