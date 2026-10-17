# Domain kernel (`@workspace/kernel`)

## Role in the architecture

Building blocks of the domain layer, free of IO and frameworks: entities, value
objects, aggregates that record events, exceptions for broken invariants, rule checks,
and specifications. `ChangeSpec` is the plain-data description of a write that
commands compile into and write paths interpret.

## Key exports

- `Entity`, `ValueObject`, `AggregateRoot` (`pullEvents()`).
- `defineEvent(name, schema)`, `DomainEvent`.
- `ExceptionBase` (stable `code`), `applyRules`, `DomainRule`.
- `QuerySpec` with `isSatisfiedBy`; `ChangeSpec`, `ValueRef`, `resolveValue`.
- `compareText`, `byText`: the one text ordering of the workspace.
- `TENANT_KEY_PATTERN`, `isTenantKey`: the one rule for an organisation's key (2 to 32
  lowercase letters, digits and underscores, starting with a letter), checked by the domain,
  the gateway and the replica.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
