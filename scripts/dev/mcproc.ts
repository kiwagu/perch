/**
 * What `bun run dev` reads from mcproc about this checkout: the dev stand's values and the
 * addresses of its dedicated services (`mcproc --json describe`, which resolves the manifest's
 * vars for the checkout's slot, so a worktree gets its own ports), and whether the pm2 stand's own
 * gateway and web run (`mcproc --json ls`).
 */

import { spawnSync } from 'node:child_process'

import { z } from '@workspace/zod'

import { STAND_VARS, type Stand, standFrom } from '../stand-gateway/index.ts'

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

const lsSchema = z.array(z.object({ app: z.string(), status: z.string() }))

/** The statuses of an app pm2 runs or is about to run (a queued start included). */
const ACTIVE = new Set(['online', 'launching', 'stopping', 'waiting restart', 'queued'])

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
    parsed.data.some((row) => row.app === app && ACTIVE.has(row.status))

  return { running: { gateway: runs(DEV_SCRIPTS.gateway), web: runs(DEV_SCRIPTS.web) } }
}

/** Runs `mcproc --json <args>` for the checkout at `root`: its JSON, or why there is none. */
export function mcprocJson(root: string, args: readonly string[]): { json: unknown } | string {
  const command = `mcproc --json ${args.join(' ')}`
  const result = spawnSync('mcproc', ['--project', root, '--json', ...args], { encoding: 'utf8' })

  if (result.error) {
    return `${command} could not run (${result.error.message}): bun run dev reads this checkout's stand from the mcproc CLI, so put it on PATH (npm i -g mcproc)`
  }

  if (result.status !== 0) {
    return `${command} failed with exit code ${result.status ?? 'none'}: ${result.stderr.trim()}`
  }

  try {
    return { json: JSON.parse(result.stdout) as unknown }
  } catch {
    return `${command} printed no JSON`
  }
}
