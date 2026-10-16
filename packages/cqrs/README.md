# Command and query buses (`@workspace/cqrs`)

## Role in the architecture

Typed buses for commands and queries with a middleware pipeline, and an event bus that
publishes after a change is committed. Every call carries an explicit
`ExecutionContext` (actor, device, tenant, correlation) instead of ambient storage, so
the same code runs in the browser and on a server.

## Key exports

- `createBus(handlers, middleware)`: a bus built from a record with one handler per message type.
- `Middleware`, `validatePayloads(schemas)`: payload validation as middleware.
- `EventBus`: `subscribe(name, subscriber)`, `publish(events)`.
- `ExecutionContext`, `Message`, `BusError`.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
