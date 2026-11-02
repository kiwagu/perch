import { describe, expect, it } from 'bun:test'

import { gatewaySettings } from '../stand-gateway/index.ts'

import { devStand, pm2Scripts } from './mcproc.ts'

const SECRET = 'stand-only-auth-secret-not-for-any-deployment-0123456789abcdef'

/**
 * What `mcproc --json describe` prints for a checkout of the given slot (trimmed to the fields
 * bun run dev reads and a few beside them): slot 0 is the main checkout, a worktree's slot comes
 * from its `.mcproc/mcproc.local.yaml` and shifts every port by 100.
 */
const describeOf = (slot: number) => {
  const project = slot === 0 ? 'perch' : `perch-w${slot}`
  const port = (base: number) => base + slot * 100

  return {
    project,
    root: `/repos/${project}`,
    slot,
    vars: [
      { name: 'project', value: project, source: 'built-in' },
      { name: 'slot', value: slot, source: slot === 0 ? 'manifest' : 'override' },
      { name: 'surreal_dev', value: port(8000), source: 'manifest' },
      { name: 'surreal_e2e', value: port(8010), source: 'manifest' },
      { name: 'gateway', value: port(5181), source: 'manifest' },
      { name: 'gateway_e2e', value: port(5191), source: 'manifest' },
      { name: 'front', value: port(5443), source: 'manifest' },
      { name: 'maildev_smtp', value: port(1025), source: 'manifest' },
      { name: 'maildev_web', value: port(1080), source: 'manifest' },
      { name: 'stand_mail_from', value: 'Perch <no-reply@example.test>', source: 'manifest' },
      { name: 'ui_manifest', value: '1', source: 'manifest' },
      { name: 'stand_auth_secret', value: SECRET, source: 'manifest' },
    ],
    apps: [
      { name: 'surrealdb-dev', kind: 'server', url: `http://127.0.0.1:${port(8000)}/health` },
      { name: 'maildev-dev', kind: 'server', url: `http://127.0.0.1:${port(1080)}/healthz` },
      { name: 'web', kind: 'build', url: null },
      { name: 'gateway', kind: 'server', url: `http://127.0.0.1:${port(5181)}/health` },
      { name: 'caddy-dev', kind: 'server', url: `https://localhost:${port(5443)}/` },
    ],
  }
}

describe("the dev stand read from mcproc's describe", () => {
  it("is the main checkout's on slot 0", () => {
    expect(devStand(describeOf(0))).toEqual({
      devStand: {
        slot: 0,
        stand: {
          surreal: 8000,
          gateway: 5181,
          front: 5443,
          smtp: 1025,
          mailFrom: 'Perch <no-reply@example.test>',
          authSecret: SECRET,
        },
        urls: {
          surreal: 'http://127.0.0.1:8000/health',
          mailbox: 'http://127.0.0.1:1080/healthz',
          front: 'https://localhost:5443/',
        },
      },
    })
  })

  it("is a slot-1 worktree's own, and so are the gateway's settings", () => {
    const read = devStand(describeOf(1))

    if (!('devStand' in read)) {
      throw new Error(read.problems.join('; '))
    }

    expect(read.devStand.slot).toBe(1)
    expect(read.devStand.urls).toEqual({
      surreal: 'http://127.0.0.1:8100/health',
      mailbox: 'http://127.0.0.1:1180/healthz',
      front: 'https://localhost:5543/',
    })
    expect(gatewaySettings(read.devStand.stand)).toEqual({
      SURREAL_URL: 'ws://127.0.0.1:8100/rpc',
      GATEWAY_PORT: '5281',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-stand-password',
      GATEWAY_AUTH_SECRET: SECRET,
      GATEWAY_PUBLIC_URL: 'https://localhost:5543',
      GATEWAY_SMTP_URL: 'smtp://127.0.0.1:1125',
      GATEWAY_MAIL_FROM: 'Perch <no-reply@example.test>',
    })
  })

  it('names a var the manifest lacks and a service with no url', () => {
    const described = describeOf(0)

    expect(
      devStand({
        ...described,
        vars: described.vars.filter(({ name }) => name !== 'maildev_smtp'),
        apps: described.apps.filter(({ name }) => name !== 'caddy-dev'),
      }),
    ).toEqual({
      problems: ['the var maildev_smtp: is missing', 'the app caddy-dev declares no url'],
    })
  })

  it('refuses what is not a describe of a project', () => {
    expect(devStand({ project: 'perch' })).toEqual({
      problems: [
        'mcproc --json describe printed what bun run dev cannot read at slot',
        'mcproc --json describe printed what bun run dev cannot read at vars',
        'mcproc --json describe printed what bun run dev cannot read at apps',
      ],
    })
  })
})

describe("the pm2 stand's dev scripts read from mcproc's ls", () => {
  const ls = (gateway: string, web: string) => [
    { app: 'surrealdb-dev', status: 'online' },
    { app: 'gateway', status: gateway },
    { app: 'web', status: web },
    { app: 'gateway-e2e', status: 'online' },
  ]

  it('run while pm2 runs them, restarts them or is about to start them', () => {
    expect(pm2Scripts(ls('online', 'queued'))).toEqual({ running: { gateway: true, web: true } })
    expect(pm2Scripts(ls('waiting restart', 'launching'))).toEqual({
      running: { gateway: true, web: true },
    })
  })

  it('do not run once stopped, never started, done or failed', () => {
    expect(pm2Scripts(ls('stopped', 'not-started'))).toEqual({
      running: { gateway: false, web: false },
    })
    expect(pm2Scripts(ls('failed (exit 1)', 'errored'))).toEqual({
      running: { gateway: false, web: false },
    })
  })
})
