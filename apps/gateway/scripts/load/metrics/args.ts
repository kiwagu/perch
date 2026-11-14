/** The profile and the stand of one load run. */
export interface LoadArgs {
  devices: number[]
  members: number
  writers: number
  rate: number
  hold: number
  gatewayPort: number
  surrealUrl: string
  /** The stand's docker container; `undefined` when it is not known, which skips its stats. */
  surrealContainer: string | undefined
  gatewayUser: string
  gatewayPass: string
  json?: string
  stopOnDegrade: boolean
  /** Whether the run ends with the restart of its gateway; `--no-restart` leaves it out. */
  restart: boolean
}

function numberFlag(flag: string, value: string | undefined): number {
  const parsed = Number(value)

  if (value === undefined || value.trim() === '' || !Number.isFinite(parsed)) {
    throw new Error(`${flag} needs a number, got ${value === undefined ? 'nothing' : `"${value}"`}`)
  }

  return parsed
}

/** The port of the e2e stand of the main checkout; worktree slots shift it by 100 each. */
const E2E_PORT = 8010
const SLOT_PORT_STEP = 100

/**
 * The docker container of the e2e stand at `surrealUrl`: `perch-surrealdb-e2e` on port 8010,
 * `perch-w<slot>-surrealdb-e2e` on 8010 plus 100 per slot, none on any other port.
 */
export function standContainer(surrealUrl: string): string | undefined {
  const port = URL.canParse(surrealUrl) ? Number(new URL(surrealUrl).port) : Number.NaN
  const slot = (port - E2E_PORT) / SLOT_PORT_STEP

  if (!Number.isInteger(slot) || slot < 0) return undefined

  return slot === 0 ? 'perch-surrealdb-e2e' : `perch-w${slot}-surrealdb-e2e`
}

function checked(flag: string, ok: boolean, domain: string): void {
  if (!ok) throw new Error(`${flag} must be ${domain}`)
}

/** Refuses values outside the domains the run can work with, naming the flag. */
function checkDomains(args: LoadArgs): void {
  checked(
    '--devices',
    args.devices.every(
      (total, i) => Number.isInteger(total) && total > 0 && total > (args.devices[i - 1] ?? 0),
    ),
    'positive integers, each larger than the one before',
  )
  checked('--members', Number.isInteger(args.members) && args.members > 0, 'a positive integer')
  checked('--writers', args.writers >= 0 && args.writers <= 1, 'between 0 and 1')
  checked('--rate', args.rate > 0, 'above 0')
  checked('--hold', args.hold > 0, 'above 0')
  checked(
    '--gateway-port',
    Number.isInteger(args.gatewayPort) && args.gatewayPort >= 1 && args.gatewayPort <= 65535,
    'an integer from 1 to 65535',
  )
}

/** Reads the run's flags over their defaults; the stand address comes from `SURREAL_URL`. */
export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LoadArgs {
  const surrealUrl = env['SURREAL_URL']

  if (!surrealUrl) throw new Error('SURREAL_URL is required: run through mcproc exec or set it')

  const args: LoadArgs = {
    devices: [100, 500, 1000, 2000],
    members: 20,
    writers: 0.3,
    rate: 0.1,
    hold: 60,
    gatewayPort: 5197,
    surrealUrl,
    surrealContainer: standContainer(surrealUrl),
    gatewayUser: env['GATEWAY_SURREAL_USER'] ?? 'gateway',
    gatewayPass: env['GATEWAY_SURREAL_PASS'] ?? 'gateway-stand-password',
    stopOnDegrade: false,
    restart: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? ''

    if (flag === '--stop-on-degrade') {
      args.stopOnDegrade = true
      continue
    }

    if (flag === '--no-restart') {
      args.restart = false
      continue
    }

    const value = argv[++i]

    switch (flag) {
      case '--devices':
        args.devices = (value ?? '').split(',').map((part) => numberFlag(flag, part))
        break
      case '--members':
        args.members = numberFlag(flag, value)
        break
      case '--writers':
        args.writers = numberFlag(flag, value)
        break
      case '--rate':
        args.rate = numberFlag(flag, value)
        break
      case '--hold':
        args.hold = numberFlag(flag, value)
        break
      case '--gateway-port':
        args.gatewayPort = numberFlag(flag, value)
        break
      case '--surreal-container':
        if (value === undefined) throw new Error('--surreal-container needs a name')
        args.surrealContainer = value
        break
      case '--json':
        if (value === undefined) throw new Error('--json needs a path')
        args.json = value
        break
      default:
        throw new Error(`unknown flag ${flag}`)
    }
  }

  checkDomains(args)

  return args
}
