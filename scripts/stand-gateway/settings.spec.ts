import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { z } from '@workspace/zod'

import {
  GATEWAY_SETTINGS,
  gatewaySettings,
  operatorSettings,
  type Stand,
  standFrom,
} from './settings.ts'

const SECRET = 'stand-only-auth-secret-not-for-any-deployment-0123456789abcdef'

/** The dev stand of a checkout's slot, as the manifest's vars give it. */
const devStand = (slot: number): Stand => ({
  surreal: 8000 + slot * 100,
  gateway: 5181 + slot * 100,
  front: 5443 + slot * 100,
  smtp: 1025 + slot * 100,
  mailFrom: 'Perch <no-reply@example.test>',
  authSecret: SECRET,
})

describe("a stand's gateway settings", () => {
  it('are those the gateway ran with from the manifest, for the main checkout', () => {
    expect(gatewaySettings(devStand(0))).toEqual({
      SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
      GATEWAY_PORT: '5181',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-stand-password',
      GATEWAY_AUTH_SECRET: SECRET,
      GATEWAY_PUBLIC_URL: 'https://localhost:5443',
      GATEWAY_SMTP_URL: 'smtp://127.0.0.1:1025',
      GATEWAY_MAIL_FROM: 'Perch <no-reply@example.test>',
    })
  })

  it("follow a worktree's slot in every address", () => {
    expect(gatewaySettings(devStand(1))).toMatchObject({
      SURREAL_URL: 'ws://127.0.0.1:8100/rpc',
      GATEWAY_PORT: '5281',
      GATEWAY_PUBLIC_URL: 'https://localhost:5543',
      GATEWAY_SMTP_URL: 'smtp://127.0.0.1:1125',
    })
  })

  it('are every variable the list names, and no other', () => {
    expect(Object.keys(gatewaySettings(devStand(0))).sort()).toEqual([...GATEWAY_SETTINGS].sort())
  })

  it('are all declared to turbo, which strips an undeclared variable from a task', () => {
    const turbo = z
      .object({ globalPassThroughEnv: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(new URL('../../turbo.json', import.meta.url), 'utf8')))

    expect(GATEWAY_SETTINGS.filter((name) => !turbo.globalPassThroughEnv.includes(name))).toEqual(
      [],
    )
  })
})

describe("the stand operator's settings", () => {
  it("are the stand's SurrealDB as its root", () => {
    expect(operatorSettings(devStand(2))).toEqual({
      SURREAL_URL: 'ws://127.0.0.1:8200/rpc',
      SURREAL_USER: 'root',
      SURREAL_PASS: 'root',
    })
  })
})

describe('a stand read from named values', () => {
  const names = {
    surreal: 'surreal_dev',
    gateway: 'gateway',
    front: 'front',
    smtp: 'maildev_smtp',
    mailFrom: 'stand_mail_from',
    authSecret: 'stand_auth_secret',
  }
  const values = (overrides: Record<string, unknown>) => (name: string) =>
    ({
      surreal_dev: 8000,
      gateway: 5181,
      front: 5443,
      maildev_smtp: '1025',
      stand_mail_from: 'Perch <no-reply@example.test>',
      stand_auth_secret: SECRET,
      ...overrides,
    })[name]

  it('takes numbers and numerals as ports', () => {
    expect(standFrom(names, values({}))).toEqual({ stand: devStand(0) })
  })

  it('names each value that is missing or wrong, never its content', () => {
    const read = standFrom(
      names,
      values({ surreal_dev: undefined, front: 70000, stand_mail_from: '' }),
    )

    expect(read).toEqual({
      problems: [
        'surreal_dev: is missing',
        'front: must be a port number, 1-65535',
        'stand_mail_from: must not be empty',
      ],
    })
  })
})
