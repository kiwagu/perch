# Logger (`@workspace/logger`)

## Role in the architecture

The only package that depends on pino. Every module logs through a logger bound to its
name; level and format come from `LOG_LEVEL` and `LOG_FORMAT` (`json` or `human`).

## Key exports

- `createLogger(module, options?)`: a server-side logger.
- `readLogConfig(env)`: parses `LOG_LEVEL` and `LOG_FORMAT`.
- `./client` `createLogger(module, options?)`: the browser logger.

## Commands

- `bun run test`, `bun run typecheck`, `bun run lint`.
