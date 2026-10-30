# Command and query buses (`@workspace/cqrs`)

## Role in the architecture

Typed buses for commands and queries with a middleware pipeline, and an event bus that
publishes after a change is committed. Every call carries an explicit
`ExecutionContext` (actor, device, tenant, correlation) instead of ambient storage, so
the same code runs in the browser and on a server.

## Key exports

- `createBus(handlers, middleware)`: a bus built from a record with one handler per message type.
- `Middleware`, `validatePayloads(schemas)`: payload validation as middleware.
- `EventBus`: `subscribe(name, subscriber)`, `once(name, subscriber)` (the first event only),
  `onAny(subscriber)` (every event, after the subscribers of its name), `publish(events)`, which
  waits for every subscriber; a subscriber that fails or throws is collected into
  `bus:SUBSCRIBER_FAILED` (a throw as `bus:SUBSCRIBER_THREW`) and the others still run.
- `fakeEventBus()`: for tests, the bus with what was `published` and
  `assertPublished(name, predicate?)`.
- `ExecutionContext`, `Message`, `BusError`.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
