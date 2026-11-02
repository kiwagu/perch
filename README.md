# Perch

*The perch your apps sit on.*

Perch is my playground for architectural decisions. It is a working foundation for local-first
web applications on SurrealDB and Loro, in which every device keeps its own database and a
gateway keeps it in step with the central one. It is also a testbed for a way of building
software: **contract first** and **AI-native**, with AI agents working to one set of rules, the
architecture decided in the contract and the code following it.

The name comes from Loro, Spanish for parrot (Spanish is the application's second language): a
perch is the base a parrot sits on, with a view of everything around it.

## Principles

Architectural ideas are tested here against a real system rather than a diagram, under three
principles:

- **A better idea replaces the old one.** There are no compatibility shims, fallbacks or
  migrations kept for data that does not exist yet: before production, the schema and the code
  are reset rather than layered.
- **A decision that holds becomes a check:** a lint rule, a contract check or a step of the
  pre-commit hook, not a wiki page or a comment, so that breaking it fails the build.
- **One context per branch.** A branch holds the work of one area and lands on `main` as a
  single squash commit, so the history of `main` reads as a list of decisions.

## Architectural decisions

| Question | Decision |
|---|---|
| Where does a device's source of truth live? | In Loro CRDT documents, one per access region; the local SurrealDB is their materialized view. |
| Where is SQL written? | Only in `.surql` files next to the component that owns them. TypeScript imports the compiled, typed shape and never carries SurrealQL text. |
| Who may write a record? | The schema states it in annotations (`-- @owner author`, `-- @can`), and the permission suites are generated from them. |
| What is a tenant? | An organisation, with a database of its own. |
| Where is a screen designed? | In a YAML file, before any JSX is written. |
| What drives a screen's transient state? | Its flow, an XState v5 machine, never a component's own flags. |
| What is a route? | A state address: the same path and search reach the same state after a reload. |
| How does a test locate an element? | By an anchor from a closed grammar (`user.sign-in.email-input`) and by codes, never by wording or CSS. |
| What if the contract cannot express a requirement? | The gap is reported in four lines and left unbuilt; it is never emulated. |
| How large may a source file grow? | 300 lines is a warning, 400 the red zone, 500 a split now. |

## Contract first

The application is described in `contract/` before it is written, and the code and the tests
are checked back against that description. The page is not a source of truth; it is a rendering
of the contract.

```text
  domain/model.schema.json      what exists: the entities, their fields and actions,
            │                   who may run them (JSON Schema 2020-12 with an x-perch keyword)
            ▼
  domain/screens/<path>.yaml    how a screen unfolds the model: its routes, the anchors
            │                   bound to fields and actions, its flow as an XState machine
            ▼
  domain/activities/<id>.yaml   tasks that span screens: machines whose states are visits
            │
            ▼
  tests/e2e/scenarios/*.md      the behaviour as a person would check it by hand,
            │                   written from the contract alone
            │
  ══════════╪═══════════  review: the developer reads `bun run contract:diff main` and approves
            ▼
  code and tests                the JSX held to the contract by contract:check:sources,
                                the e2e tests by contract:check:consumers
```

The formats are the standard ones: a flow is an XState v5 machine configuration and a route is
a TanStack Router route. `contract:check` runs every flow and activity in XState, and tests hold
the application's machines to their flows and its router to the routes. Each scenario is paired
step by step with a Playwright spec, and the stands serve the UI manifest built from the
contract at `/ui-manifest/manifest.json` by default. The full guide is
[contract/README.md](contract/README.md).

## AI-native

The codebase is organised to be read by agents, and the responsibilities are divided between
the developer and the agents:

| Area | The developer | The agents |
|---|---|---|
| Architecture | decides it, in the contract | propose patterns, with their trade-offs |
| Contract | reviews and approves each commit of it | draft it in a modeling thread, separately from the code |
| Code | relies on the contract: the code makes no architectural decisions of its own | implement it from the approved contract, in parallel |
| Contract gaps | decides whether the contract is extended now or the feature waits | report them in four lines and never work around them |

One rule set in `.cursor/rules/` serves every agent, and the pre-commit hook enforces what the
rules state. [docs/agents/README.md](docs/agents/README.md) describes the mechanisms behind this
division.

## Architecture

```text
┌───────────────────────────────────────────┐
│ each device: React · TanStack · XState    │
│ Loro documents, one per access region     │
│   └─▶ projected into a local SurrealDB    │
│       (WASM in a Web Worker, IndexedDB)   │
└─────────────────────┬─────────────────────┘
                      │  one WebSocket, from the leading tab
┌─────────────────────┴─────────────────────┐
│ gateway (Bun): accounts · sync · tenants  │
│ replays every batch on a fork first       │
└─────────────────────┬─────────────────────┘
                      │
┌─────────────────────┴─────────────────────┐
│ central SurrealDB: a directory database   │
│ and one database per organisation         │
└───────────────────────────────────────────┘
```

- **A replica per identity.** Each signed-in identity has a SurrealDB engine in a Web Worker on
  its own IndexedDB database, and one more for each organisation it belongs to; replicated data
  lives in Loro documents projected into them.
- **Verified sync.** The leading tab of a browser keeps every region in step over a single
  WebSocket. The server checks each pushed batch on a fork of the region's document before it
  accepts it, and binds each Loro peer to the identity that pushed it.
- **Accounts and devices.** Accounts run on Better Auth and verify their email before the first
  sign-in; each device holds a session token of its own and can be signed out from another one.

**Stack:** Bun · TypeScript 7 · React 19 · TanStack Router · XState 5 · Zod 4 · SurrealDB 3 ·
Loro · Better Auth · Tailwind 4 and shadcn · Vite · Vitest · Playwright · Turborepo · Caddy ·
mcproc.

## Current state

The following works end to end, on a phone and on a desktop: sign-up with email verification
and sign-in with device sessions; a profile kept in step across devices and while offline;
settings with the theme and the language, English or Spanish; the devices page; organisations
with members, invitations and shared notes under roles; and an app shell that shows the state
of the sync, offers a reload when a new version is out, answers unknown addresses and crashes,
and installs as an app that opens offline. Every scenario is paired with its Playwright test,
production builds are held to size budgets for phones, and a load test drives simulated devices
against the gateway.

As a playground, any part of it may be replaced by a better design; that is intended.

## Getting started

```sh
bun install
mcproc start dev     # SurrealDB, the gateway, a mailbox and the front
bun run seed         # demo accounts and an organisation
bun run check        # the gate for a change
```

Then open https://localhost:5443. The prerequisites and a walk through the application are in
[docs/development/getting-started.md](docs/development/getting-started.md).

## Documentation

| Topic | Where |
|---|---|
| Prerequisites and the first run | [docs/development/getting-started.md](docs/development/getting-started.md) |
| Gates and commands | [docs/development/commands.md](docs/development/commands.md) |
| Local stands and worktrees | [.mcproc/README.md](.mcproc/README.md) |
| The front and the mailbox | [infra/dev/README.md](infra/dev/README.md) |
| The UI contract | [contract/README.md](contract/README.md) |
| Working with agents | [docs/agents/README.md](docs/agents/README.md) |
| The workspaces and everything in `docs/` | [docs/README.md](docs/README.md) |
