import { describe, expect, it } from 'bun:test'

import { isolatedCommand } from './isolated-network'

/** The ports `--tcp-ns` forwards to the host in `args`. */
function forwarded(args: readonly string[]): string | undefined {
  return args[args.indexOf('--tcp-ns') + 1]
}

describe('the e2e run in a network namespace of its own', () => {
  it("runs the command under pasta on IPv4 only, with the host's setup copied in and nothing forwarded into the namespace", () => {
    const args = isolatedCommand(['bunx', 'playwright', 'test', '--grep', '@smoke'], {
      E2E_BASE_URL: 'https://localhost:5493',
      MAILBOX_URL: 'http://127.0.0.1:1090',
    })

    expect(args.slice(0, 4)).toEqual(['pasta', '--quiet', '--ipv4-only', '--config-net'])
    expect(args[args.indexOf('--tcp-ports') + 1]).toBe('none')
    expect(args[args.indexOf('--udp-ports') + 1]).toBe('none')
    expect(args[args.indexOf('--udp-ns') + 1]).toBe('none')
    expect(args.slice(args.indexOf('--') + 1)).toEqual([
      'bunx',
      'playwright',
      'test',
      '--grep',
      '@smoke',
    ])
  })

  it('forwards the loopback ports of the front and the mailbox, and no other address of the environment', () => {
    const args = isolatedCommand(['true'], {
      E2E_BASE_URL: 'https://localhost:5493',
      MAILBOX_URL: 'http://127.0.0.1:1090',
      GATEWAY_URL: 'http://127.0.0.1:5191',
      SURREAL_URL: 'http://127.0.0.1:8010',
    })

    expect(forwarded(args)).toBe('5493,1090')
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
