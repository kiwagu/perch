# Gates and commands

## Gates

- `bun run check`: type checks, lint, unit tests and the model, i18n, refactor, README and e2e
  coverage checks, the three UI contract checks (`contract:check`,
  `contract:check:sources`, `contract:check:consumers`) and the check of the coverage block
  (`contract:coverage:check`); the gate for a change.
  `bun run check --force` runs every task afresh instead of replaying turbo's cache. It runs its
  tasks four at a time, at low CPU priority and with vitest's workers capped, for the reasons
  `bun run test` gives below.
- `bun run test:db` with the `e2e` stand up (`mcproc start e2e`): the schema permission suites,
  the seed and the gateway smoke test against the e2e stand. The suites, the seed and the e2e
  launcher run through `mcproc exec`, which gives them this checkout's addresses (`SURREAL_URL`,
  `GATEWAY_URL`, `E2E_BASE_URL` and the mailbox's `MAILBOX_URL` of the e2e stand,
  `SURREAL_DEV_URL`, `GATEWAY_DEV_URL` and `MAILBOX_DEV_URL` of the dev stand) and what the e2e
  stand's gateway runs with: the stands' auth secret `GATEWAY_AUTH_SECRET`, the public origin
  of its front, `GATEWAY_PUBLIC_URL`, its mail server `GATEWAY_SMTP_URL` and the stands' From
  `GATEWAY_MAIL_FROM`; none of them has an address of its own. Each suite is described in the
  README of its workspace: [database](../../database/README.md), [seed](../../seed/README.md)
  and [apps/gateway](../../apps/gateway/README.md).
- `CI=1 bun run test:e2e`: builds (the web app's production build included), starts the `e2e`
  profile, waits for each of its apps and runs the Playwright specs through the front on two
  workers, every test on a phone and the `@smoke` ones on a desktop too, about 5 minutes in all;
  `mcproc stop e2e` stops the profile. The run writes `apps/web/dist`, which only the e2e
  front serves, so it leaves the dev stand's build alone. It holds a 4G memory lease for its
  build and browsers, and it runs in mcproc's `e2e` group (`--exclusive e2e`, with
  `perf:measure`): one of them at a time on the host, whichever checkout starts it. A run waits
  its turn when the host is short of memory or another run holds the group, says once whom it
  waits for and gives up after an hour; `mcproc leases` shows the queue and the holder.
  [tests/e2e/README.md](../../tests/e2e/README.md) has the rest.

`bun run test:db` and `CI=1 bun run test:e2e`, run without arguments, record a receipt for the
tree they passed on in the gitignored `.gates/` folder (`scripts/gates/`; a run given a spec or a
filter records none); a commit on `main` is refused without both receipts for exactly its tree.

## The development stand

- `mcproc start dev`: the whole development stand under pm2: SurrealDB, the mailbox, the gateway,
  the web app's build watcher and the front. For a stand that just runs, an agent's or in the
  background; `mcproc stop dev` stops it.
- `mcproc start services`: the stand's dedicated services alone, SurrealDB, the mailbox and the
  front, for `bun run dev`.
- `bun run dev`: the Bun dev scripts in the foreground through turbo, the gateway (`bun --watch`)
  and the web app's build watcher, with this checkout's development stand: it reads the stand
  from `mcproc --json describe` (a worktree gets its own ports), defines the gateway's user on its
  SurrealDB and gives the gateway the settings the manifest's `gateway` app starts with
  (`scripts/stand-gateway/`). It stops before it starts when the dev SurrealDB or the mailbox
  does not answer (`mcproc start services`), when the pm2 gateway or watcher of `mcproc start dev`
  runs (`mcproc stop gateway && mcproc stop web`), or when another process holds the gateway's
  port, and warns when the front does not answer. `--exclude <workspace>` (or `-x`, comma lists
  too) leaves a workspace out; what follows `--` goes to turbo. Ctrl-C stops it.

## Commands of the root

- `bun run test`: every package's unit and functional tests, four packages at a time (all of
  them at once starved one another past vitest's 5 s timeout in the pre-commit hook, at no gain
  in time), each vitest on at most four workers (`VITEST_MAX_WORKERS`, 4 unless the environment
  sets it: a machine that runs nothing beside it may give vitest every core), at low CPU priority
  (`nice -n 10`, as `typecheck`, `lint` and `check` run), so an e2e run on the same host gets the
  CPU first. Measured on a 20-thread host beside an e2e run: uncapped, the unit tests took up to
  18 threads and the e2e's slowest test went from 15 s to 22 s; capped and niced, it took 15 to
  16 s, and `check` took 78 to 88 s against 80 s uncapped (63 to 71 s when nothing else runs,
  either way). Part of the pre-commit hook.
- `bun run build`: production builds, leaving two cores free (`BUILD_RESERVED_CORES`).
- `bun run model`: regenerate the models, page model, permission suites and replica schema.
- `bun run refactor:scan`: files past the size tiers (300 warn, 400 red zone, 500 split now),
  largest first, with their baseline.
- `bun run refactor:ci`: the size ratchet over `refactor-baseline.json`, a machine-local,
  gitignored file that the first run on a checkout writes from the sizes committed where HEAD
  left `main`, never from the working tree (also in `check` and in the pre-commit hook): a file
  at or above 400 lines the baseline does not know, or a baselined file that grew, fails, so a
  branch's growth fails from its checkout's first run.
- `bun run refactor:baseline`: rewrites `refactor-baseline.json` from the whole tree after a
  split; it only shrinks, so a grown or new entry needs `--allow-growth` and an owner decision.

## The UI contract

Every contract command is described, with its flags and output, in
[packages/ui-contract/README.md](../../packages/ui-contract/README.md); the contract comes first,
and [contract/README.md](../../contract/README.md) says how a change runs from the model to the
screen file, the scenario, the code and the tests.

- `bun run contract:check`, `bun run contract:check:sources` and
  `bun run contract:check:consumers` (all three in `check` and in the pre-commit hook): the
  contract files and the scenarios against each other, every description they write within
  200 characters among them, then the anchors and codes of the web app and the UI kit against
  them, then the anchors, codes, states and values the e2e tests name.
- `bun run contract:schemas`: writes the JSON Schemas of the contract files from their Zod
  sources (`-- --check` fails on drift).
- `bun run contract:manifest`: builds the UI manifest from `contract/` and the scenario files
  into `ui-manifest/`.
- `bun run contract:diff <ref>`: what the contract adds, removes and renames against a git
  ref, each written description changed with its length before and after among it; a change to
  the contract hands over the output of `bun run contract:diff main`.
- `bun run contract:coverage`: the fields and actions of the model bound by anchors, the
  controls carrying an anchor per feature module, and the anchors and scenarios per screen;
  `--write` updates `contract/COVERAGE.md`, `--unmarked` lists the controls left unmarked and
  the ones declared off with `ui-contract-ignore: <reason>`. `bun run contract:coverage:check`
  (in `check` and in the pre-commit hook on `main`) fails when the block of
  `contract/COVERAGE.md` is not what `--write` writes.
- `bun run contract:routes`: the routes of the screen files, one example deep link each,
  where each is reached from and the route tree (`-- --json` for all of it as JSON).
- `bun run contract:flow <screen>`: a screen's flow as the full XState configuration its
  shorter forms expand into.

## Commands of the workspaces

Run from the root; each is described in the README named beside it.

| Command | What it does | README |
|---|---|---|
| `bun run seed`, `bun run seed:sweep` | seed the dev stand through its gateway, or remove the seed data (with the dev stand's addresses from `mcproc exec`; neither needs the auth secret) | [seed](../../seed/README.md) |
| `bun run load -- --devices 20 --members 10 --hold 15` | the gateway load test: a gateway of its own on port 5197 in front of the e2e stand's SurrealDB, one table row per step | [apps/gateway](../../apps/gateway/README.md), *Load test* |
| `bun run perf:measure` | the start's timings on a slowed-down phone against their budgets, on the production build the e2e stand serves, in turn with the e2e runs (mcproc's `e2e` group) | [tests/e2e](../../tests/e2e/README.md) |
| `bun run e2e:scaffold <scenario id>`, `bun run e2e:coverage` | the failing test of a new scenario, and the check that every scenario has its test | [tests/e2e](../../tests/e2e/README.md) |
| `bun run i18n:check` | translation keys against the catalogs | [apps/web](../../apps/web/README.md) |
| `bun run --filter @workspace/replica measure`, `measure:validation` | the replica's write path, and what checking a pushed batch costs the server, on this machine | [packages/replica](../../packages/replica/README.md) |

The size budgets of a production build are checked by every `bun run build`
([apps/web/README.md](../../apps/web/README.md)).
