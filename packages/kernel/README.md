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
- `checkPasswordRules`, `keepsPasswordRules`, `PASSWORD_RULES`, `PASSWORD_LENGTH`,
  `PASSWORD_SYMBOLS`: the one set of rules for a new password (10 to 35 characters, only Latin
  letters, digits and the 32 printable ASCII symbols, with at least one digit, one uppercase
  letter, one lowercase letter and one symbol), which rules a password keeps and whether it keeps
  them all, checked by the sign-up form as it is typed and by the gateway's sign-up. A sign-in
  checks none of them.
- `defineAbilityFor(member, schema)`, `OWNER_ABILITY`, `NO_ABILITY`: see Abilities below.
- `PLATFORM_ROLES` (`operator`) and `PlatformRole`: the roles an account holds on the platform
  itself, apart from its role in any organisation; see Abilities below.

## Abilities

`TENANT_ROLES` (`member`, `admin`) and `ACTIONS` (`create`, `update`, `delete`) are the one
source of the roles; the replica protocol builds its role enum from them. `PLATFORM_ROLES` is the
one source of the roles on the platform: `operator`, who runs the platform's console of accounts,
is the only one, and an account holds none until it is given one. They grant nothing on an
organisation's records: an operator's console is judged by the gateway, not by an `Ability`.
What a role may do to the records of a table is data: each table declares `@owner` (the field
naming the member a record belongs to) and `@can` (per role and action, scope `any` or `own`),
and the modeling stage emits them as an `AbilitySchema`. `defineAbilityFor(member, schema)`
returns an `Ability` whose `can(action, table, record?)` the browser asks before a command and
the gateway before importing a batch. An `own` scope compares the owner field with the member
id by key (`member:idn_a` and `idn_a` both name `idn_a`, see `ownerKeyOf`); a table or role
without rules allows nothing. `OWNER_ABILITY` allows everything (the owner of a private
region), `NO_ABILITY` nothing (nobody signed in). Reading is not an ability.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
