# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. Its HTTP routes sign devices up and in
(`POST /auth/sign-up`, `POST /auth/sign-in`, answering `{ identity, tokens }`), each
call on a database session of its own that is closed when the call ends. It
authenticates a device's keys, renewing the pair with the refresh key when the access
token no longer works, and revokes a device's refresh grant through the database's RPC.
It also holds the region hub, the server's copy of the replicated regions. No server
listens yet: the process opens the database and these services, and sync over
WebSocket is not served. Keys, tokens and grant ids never reach its logs.

## Key exports

None: this is an application. Its entry point is `src/index.ts`, which registers the
`.surql` loader and runs `src/main.ts`. The environment it reads is `GATEWAY_PORT`,
`SURREAL_URL` (the database's WebSocket endpoint, such as `ws://127.0.0.1:8000/rpc`),
`GATEWAY_SURREAL_USER`, `GATEWAY_SURREAL_PASS`, and optionally the logger's `LOG_LEVEL`
and `LOG_FORMAT`.

## Commands

- `bun run dev`: runs the gateway and restarts it on changes.
- `bun run test`: unit and functional tests on an embedded in-memory database.
- `bun run typecheck`, `bun run lint`.
