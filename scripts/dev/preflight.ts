/**
 * What `bun run dev` checks before it starts the Bun dev scripts, as messages: errors stop it,
 * warnings do not. The dedicated services the gateway needs (the dev SurrealDB and MailDev) must
 * answer; the pm2 stand's own gateway and web must not run beside it, nor anything else hold the
 * gateway's port; a front (caddy-dev) that does not answer only leaves the app without its page.
 */

/** What the checks found, for the dev scripts this run starts (`runs`). */
export type Observed = {
  runs: { gateway: boolean; web: boolean }
  surreal: { url: string; answers: boolean }
  mailbox: { url: string; answers: boolean }
  front: { url: string; answers: boolean }
  gatewayPort: { port: number; free: boolean }
  pm2: { gateway: boolean; web: boolean }
}

export type Preflight = { errors: string[]; warnings: string[] }

const START_SERVICES = 'start the dedicated services first: mcproc start services'

/** The errors and warnings of what the checks found. */
export function preflight(observed: Observed): Preflight {
  const { runs, surreal, mailbox, front, gatewayPort, pm2 } = observed
  const errors: string[] = []
  const warnings: string[] = []

  if (runs.gateway && !surreal.answers) {
    errors.push(`the dev SurrealDB does not answer at ${surreal.url}; ${START_SERVICES}`)
  }

  if (runs.gateway && !mailbox.answers) {
    errors.push(`the dev MailDev does not answer at ${mailbox.url}; ${START_SERVICES}`)
  }

  const clashing = [runs.gateway && pm2.gateway && 'gateway', runs.web && pm2.web && 'web'].filter(
    (app): app is string => typeof app === 'string',
  )

  if (clashing.length > 0) {
    const apps = clashing.join(' and ')
    const run = clashing.length === 1 ? 'runs' : 'run'

    // mcproc's CLI stops one app or profile at a time.
    const stop = clashing.map((app) => `mcproc stop ${app}`).join(' && ')

    errors.push(
      `the pm2 ${apps} of mcproc start dev already ${run} in this checkout; stop ${clashing.length === 1 ? 'it' : 'them'} to run the Bun dev scripts here (${stop}), or use the pm2 stand instead of bun run dev`,
    )
  } else if (runs.gateway && !gatewayPort.free) {
    errors.push(
      `127.0.0.1:${gatewayPort.port}, the dev gateway's port, is held by another process, such as another bun run dev; stop it first`,
    )
  }

  if (!front.answers) {
    warnings.push(
      `caddy-dev does not answer at ${front.url}; the gateway and the watcher run, but the app has no front until mcproc start services`,
    )
  }

  return { errors, warnings }
}
