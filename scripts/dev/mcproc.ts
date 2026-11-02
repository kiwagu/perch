/**
 * What `bun run dev` reads from mcproc about this checkout: the dev stand's values and the
 * addresses of its dedicated services (`mcproc --json describe`, which resolves the manifest's
 * vars for the checkout's slot, so a worktree gets its own ports), and whether the pm2 stand's own
 * gateway and web run (`mcproc --json ls`).
 */

import { z } from '@workspace/zod'

import { STAND_VARS, type Stand, standFrom } from '../stand-gateway/index.ts'

import { jsonOf, run } from './json-command.ts'

/** The dedicated services of the dev stand `bun run dev` works with, by their app. */
export const DEV_SERVICES = {
  surreal: 'surrealdb-dev',
  mailbox: 'maildev-dev',
  front: 'caddy-dev',
} as const

/** The apps of the pm2 stand that run what `bun run dev` runs: the gateway and the watcher. */
export const DEV_SCRIPTS = { gateway: 'gateway', web: 'web' } as const

export type DevService = keyof typeof DEV_SERVICES
export type DevScript = keyof typeof DEV_SCRIPTS

/** This checkout's dev stand: its slot, its gateway's stand values, its services' urls. */
export type DevStand = {
  slot: number
  stand: Stand
  urls: Readonly<Record<DevService, string>>
}

const describeSchema = z.object({
  slot: z.number().int(),
  vars: z.array(
    z.object({ name: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
  ),
  apps: z.array(z.object({ name: z.string(), url: z.string().nullable() })),
})

/**
 * A row of `mcproc --json ls`. An app whose start waits in the host's memory queue, or was just
 * let through it, has no pm2 process yet: its row carries the start's lease (state `pending`, the
 * status `queued #<position>`; state `starting`, the status `starting`), and pm2 runs it soon.
 */
const lsSchema = z.array(
  z.object({
    app: z.string(),
    status: z.string(),
    lease: z.object({ state: z.string() }).optional(),
  }),
)

/** The pm2 statuses of an app that runs, or is being restarted. */
const PM2_ACTIVE = new Set(['online', 'launching', 'stopping', 'waiting restart'])

/** The states of a lease whose start has not run yet: queued, or let through the queue. */
const LEASE_ACTIVE = new Set(['pending', 'starting'])

const schemaProblems = (command: string, error: z.ZodError): string[] =>
  error.issues.map(
    (issue) => `${command} printed what bun run dev cannot read at ${issue.path.join('.')}`,
  )

/** The dev stand in what `mcproc --json describe` printed, or what is missing from it. */
export function devStand(json: unknown): { devStand: DevStand } | { problems: string[] } {
  const parsed = describeSchema.safeParse(json)

  if (!parsed.success) {
    return { problems: schemaProblems('mcproc --json describe', parsed.error) }
  }

  const { slot, vars, apps } = parsed.data
  const values = new Map(vars.map(({ name, value }) => [name, value]))
  const read = standFrom(STAND_VARS.dev, (name) => values.get(name))
  const urlOf = (app: string): string | undefined =>
    apps.find(({ name }) => name === app)?.url ?? undefined
  const surreal = urlOf(DEV_SERVICES.surreal)
  const mailbox = urlOf(DEV_SERVICES.mailbox)
  const front = urlOf(DEV_SERVICES.front)

  if ('problems' in read || !surreal || !mailbox || !front) {
    return {
      problems: [
        ...('problems' in read ? read.problems.map((problem) => `the var ${problem}`) : []),
        ...Object.values(DEV_SERVICES)
          .filter((app) => !urlOf(app))
          .map((app) => `the app ${app} declares no url`),
      ],
    }
  }

  return { devStand: { slot, stand: read.stand, urls: { surreal, mailbox, front } } }
}

/** Which of the pm2 stand's gateway and web run, in what `mcproc --json ls` printed. */
export function pm2Scripts(
  json: unknown,
): { running: Readonly<Record<DevScript, boolean>> } | { problems: string[] } {
  const parsed = lsSchema.safeParse(json)

  if (!parsed.success) {
    return { problems: schemaProblems('mcproc --json ls', parsed.error) }
  }

  const runs = (app: string): boolean =>
    parsed.data.some(
      (row) =>
        row.app === app &&
        (PM2_ACTIVE.has(row.status) ||
          (row.lease !== undefined && LEASE_ACTIVE.has(row.lease.state))),
    )

  return { running: { gateway: runs(DEV_SCRIPTS.gateway), web: runs(DEV_SCRIPTS.web) } }
}

/** Runs `mcproc --json <args>` for the checkout at `root`: its JSON, or why there is none. */
export function mcprocJson(root: string, args: readonly string[]): { json: unknown } | string {
  return jsonOf(
    `mcproc --json ${args.join(' ')}`,
    run('mcproc', ['--project', root, '--json', ...args], root),
    "bun run dev reads this checkout's stand from the mcproc CLI, so put it on PATH (npm i -g mcproc)",
  )
}
