# Documentation

The guides in this folder cover what spans the repository. Everything else is documented next
to what it describes: each workspace and each feature module in its own README, the UI contract
in [contract/README.md](../contract/README.md), the local stands in
[.mcproc/README.md](../.mcproc/README.md), and the front and the mailbox in
[infra/dev/README.md](../infra/dev/README.md).

## Development

- [development/getting-started.md](development/getting-started.md): the prerequisites, the first
  run and a walk through the application.
- [development/commands.md](development/commands.md): the gates a change goes through and the
  commands of the root, with where each workspace documents its own.
- [development/known-issues.md](development/known-issues.md): expected but surprising behaviour
  of the repository and its toolchain.

## Agents

- [agents/README.md](agents/README.md): how the repository is organised for AI agents, and the
  mechanisms that hold the division of work between the developer and the agents.
- [agents/context-smoke-test.md](agents/context-smoke-test.md): prompts and the rule each must
  route to, run after a rule or a skill changes.

## Workspaces

Each workspace has a README with its role, key exports and commands:

| Workspace | Role |
|---|---|
| [apps/web](../apps/web/README.md) | the browser application: each identity's local replica, synced by one leading tab per browser |
| [apps/gateway](../apps/gateway/README.md) | the Bun server in front of the central SurrealDB: accounts, devices and organisations over HTTP, sync over a WebSocket |
| [packages/replica](../packages/replica/README.md) | Loro region documents, the projector, the sync protocol, the server's region log and hub, the device's sync engine |
| [packages/data](../packages/data/README.md) | the SurrealDB driver: local databases, shapes and commands, accounts |
| [packages/modeling](../packages/modeling/README.md) | the build-time stage that compiles `.surql` files into typed models |
| [packages/ui-contract](../packages/ui-contract/README.md) | the anchor grammar and the contract tooling: the checks, the manifest, coverage and the hand-over diff |
| [database](../database/README.md) | the shared schema, its permission suites and the generated replica schema |
| [seed](../seed/README.md) | demo accounts seeded through the gateway like any device, and their sweep |
| [tests/e2e](../tests/e2e/README.md) | Playwright specs on a phone and a desktop against the `e2e` stand |

The smaller packages: [cqrs](../packages/cqrs/README.md) (the buses), [di](../packages/di/README.md)
(the container), [e2e-spec](../packages/e2e-spec/README.md) (the e2e spec tooling),
[email](../packages/email/README.md) (the mails), [eslint-config](../packages/eslint-config/README.md)
(lint rules), [i18n](../packages/i18n/README.md) (translations and formats),
[ids](../packages/ids/README.md) (entity ids), [kernel](../packages/kernel/README.md) (the domain
kernel), [logger](../packages/logger/README.md), [mailbox](../packages/mailbox/README.md) (the client
of the stands' mailboxes), [ui](../packages/ui/README.md) (the UI kit) and
[zod](../packages/zod/README.md) (the single Zod instance).
