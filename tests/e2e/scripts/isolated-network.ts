/**
 * The e2e browser's own network. Chromium on Linux aborts every request in flight
 * (`net::ERR_NETWORK_CHANGED`) whenever a network interface it can see comes or goes or changes
 * its address, and every container started or stopped on the host, a stand of another checkout
 * or another project's, adds or removes one. So Playwright runs in a network namespace of its own,
 * made by pasta (package `passt`, rootless): pasta copies the host's IPv4 setup into it once, so
 * the browser sees a network (`navigator.onLine`) that never changes afterwards, and forwards the
 * loopback ports of the run's addresses to the host, and no other port in either direction.
 * IPv4 only: inside, `localhost` resolves to ::1 first, which pasta would forward to the host's
 * ::1, where the stand's front does not listen.
 */

import { spawnSync } from 'node:child_process'

/** The addresses the run reaches on the host: the front the browser opens, the mailbox the tests read. */
const ADDRESSES = ['E2E_BASE_URL', 'MAILBOX_URL'] as const

const LOOPBACK = new Set(['localhost', '127.0.0.1'])

/** The port of `address` when it is on the host's loopback; an address elsewhere is reached through pasta's own network. */
function loopbackPort(address: string | undefined): number | undefined {
  const url = address === undefined ? null : URL.parse(address)

  if (!url || !LOOPBACK.has(url.hostname)) {
    return undefined
  }

  return Number(url.port || (url.protocol === 'https:' ? '443' : '80'))
}

/** The pasta command that runs `command` in a network namespace of its own, reaching the host's loopback only at the run's addresses. */
export function isolatedCommand(command: readonly string[], env: NodeJS.ProcessEnv): string[] {
  const ports = [
    ...new Set(
      ADDRESSES.map((name) => loopbackPort(env[name])).filter((port) => port !== undefined),
    ),
  ]

  return [
    'pasta',
    '--quiet',
    '--ipv4-only',
    '--config-net',
    '--tcp-ports',
    'none',
    '--udp-ports',
    'none',
    '--tcp-ns',
    ports.length > 0 ? ports.join(',') : 'none',
    '--udp-ns',
    'none',
    '--',
    ...command,
  ]
}

/** Whether pasta can run here; when it cannot, says what to install, since the run never goes without its own network. */
export function pastaInstalled(who: string): boolean {
  const probe = spawnSync('pasta', ['--version'], { stdio: 'ignore' })

  if (probe.error === undefined && probe.status === 0) {
    return true
  }

  console.error(
    `${who}: the e2e browser runs in a network namespace of its own, made by pasta, which is not installed: install the passt package (sudo apt install passt on Debian or Ubuntu)`,
  )

  return false
}
