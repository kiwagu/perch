import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isolatedCommand } from './isolated-network'

/** The ports `--tcp-ns` forwards to the host in `args`. */
function forwarded(args: readonly string[]): string | undefined {
  return args[args.indexOf('--tcp-ns') + 1]
}

const scratch = mkdtempSync(join(tmpdir(), 'isolated-network-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/**
 * Runs here, on the host, what `args` starts inside the namespace, with the namespace's IPv6
 * switch replaced by `ipv6Switch`: the host's own switch is not this process's to write.
 */
function runInside(args: readonly string[], ipv6Switch: string) {
  const [shell = '', flag = '', script = '', name = '', , ...command] = args.slice(
    args.indexOf('--') + 1,
  )

  return spawnSync(shell, [flag, script, name, ipv6Switch, ...command], { encoding: 'utf8' })
}

describe('the e2e run in a network namespace of its own', () => {
  it("runs the command under pasta on IPv4 only, with the host's setup copied in, no gateway or resolver of the host and nothing forwarded into the namespace", () => {
    const args = isolatedCommand(['bunx', 'playwright', 'test', '--grep', '@smoke'], {
      E2E_BASE_URL: 'https://localhost:5493',
      MAILBOX_URL: 'http://127.0.0.1:1090',
    })

    expect(args.slice(0, 5)).toEqual([
      'pasta',
      '--quiet',
      '--ipv4-only',
      '--config-net',
      '--no-map-gw',
    ])
    expect(args[args.indexOf('--dns') + 1]).toBe('none')
    expect(args[args.indexOf('--tcp-ports') + 1]).toBe('none')
    expect(args[args.indexOf('--udp-ports') + 1]).toBe('none')
    expect(args[args.indexOf('--udp-ns') + 1]).toBe('none')
    expect(args.slice(args.indexOf('--') + 1)).toEqual([
      '/bin/sh',
      '-c',
      'echo 1 > "$1" && shift && exec "$@"',
      'sh',
      '/proc/sys/net/ipv6/conf/all/disable_ipv6',
      'bunx',
      'playwright',
      'test',
      '--grep',
      '@smoke',
    ])
  })

  it('switches IPv6 off in the namespace before the command starts', () => {
    const ipv6Switch = join(scratch, 'disable_ipv6')
    const started = runInside(isolatedCommand(['cat', ipv6Switch], {}), ipv6Switch)

    expect(started.stdout).toBe('1\n')
  })

  it('never starts the command when IPv6 cannot be switched off', () => {
    const started = runInside(
      isolatedCommand(['printf', 'started'], {}),
      join(scratch, 'missing', 'disable_ipv6'),
    )

    expect(started.status).not.toBe(0)
    expect(started.stdout).toBe('')
  })

  it('hands the command to the shell it starts with every argument as given', () => {
    const printed = runInside(
      isolatedCommand(['printf', '%s|', 'a b', "it's", '$HOME', '*'], {}),
      join(scratch, 'switch'),
    )

    expect(printed.stdout).toBe("a b|it's|$HOME|*|")
  })

  it("forwards the loopback ports of the front, the mailbox and the stand's database, and no other address of the environment", () => {
    const args = isolatedCommand(['true'], {
      E2E_BASE_URL: 'https://localhost:5493',
      MAILBOX_URL: 'http://127.0.0.1:1090',
      GATEWAY_URL: 'http://127.0.0.1:5191',
      SURREAL_URL: 'http://127.0.0.1:8010',
      SURREAL_DEV_URL: 'http://127.0.0.1:8000',
    })

    expect(forwarded(args)).toBe('5493,1090,8010')
  })

  it("takes a scheme's default port, and forwards a port named twice once", () => {
    expect(
      forwarded(
        isolatedCommand(['true'], {
          E2E_BASE_URL: 'https://localhost',
          MAILBOX_URL: 'http://localhost',
        }),
      ),
    ).toBe('443,80')
    expect(
      forwarded(
        isolatedCommand(['true'], {
          E2E_BASE_URL: 'https://localhost:5493',
          MAILBOX_URL: 'http://127.0.0.1:5493',
        }),
      ),
    ).toBe('5493')
  })

  it("leaves an address off the host's loopback to pasta's own network, and forwards nothing when none is on it", () => {
    expect(
      forwarded(
        isolatedCommand(['true'], {
          E2E_BASE_URL: 'https://stand.example.test:5493',
          MAILBOX_URL: 'not an address',
        }),
      ),
    ).toBe('none')
    expect(forwarded(isolatedCommand(['true'], {}))).toBe('none')
  })
})
