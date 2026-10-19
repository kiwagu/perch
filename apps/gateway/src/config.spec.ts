import { describe, expect, it } from 'vitest'

import { gatewayConfig } from './config'

/** A signing key of the shortest length the gateway takes. Test-only. */
const key = 'config-spec-signing-key-'.padEnd(64, '0')

const env = {
  GATEWAY_PORT: '8080',
  SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
  GATEWAY_SURREAL_USER: 'gateway',
  GATEWAY_SURREAL_PASS: 'gateway-pass',
  GATEWAY_JWT_KEY: key,
  PATH: '/usr/bin',
}

describe('gatewayConfig', () => {
  it('parses a valid environment', () => {
    expect(gatewayConfig.parse(env)).toEqual({
      GATEWAY_PORT: 8080,
      SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-pass',
      GATEWAY_JWT_KEY: key,
    })
  })

  it('names the variable that does not parse', () => {
    const parsed = gatewayConfig.safeParse({ ...env, GATEWAY_PORT: 'abc' })

    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['GATEWAY_PORT'])
  })

  it('names a missing variable', () => {
    const { GATEWAY_SURREAL_PASS: _missing, ...partial } = env
    const parsed = gatewayConfig.safeParse(partial)

    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'GATEWAY_SURREAL_PASS',
    ])
  })
})

describe('gatewayConfig.SURREAL_URL', () => {
  it('accepts a WebSocket address', () => {
    const parsed = gatewayConfig.parse({ ...env, SURREAL_URL: 'wss://db.example.test/rpc' })

    expect(parsed.SURREAL_URL).toBe('wss://db.example.test/rpc')
  })

  it('refuses an address that is not WebSocket, naming the rule', () => {
    for (const url of ['http://127.0.0.1:8000/rpc', 'https://db.example.test/rpc']) {
      const parsed = gatewayConfig.safeParse({ ...env, SURREAL_URL: url })

      expect(parsed.error?.issues.map(({ path, message }) => [path.join('.'), message])).toEqual([
        ['SURREAL_URL', 'must be a ws:// or wss:// address: auth sessions need a WebSocket'],
      ])
    }
  })
})

describe('gatewayConfig.GATEWAY_JWT_KEY', () => {
  it('is required, and its issue names it', () => {
    const { GATEWAY_JWT_KEY: _missing, ...partial } = env
    const parsed = gatewayConfig.safeParse(partial)

    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['GATEWAY_JWT_KEY'])
  })

  it('refuses a key of 63 characters, naming the rule and never the value', () => {
    const short = 'config-spec-short-key-'.padEnd(63, '1')
    const parsed = gatewayConfig.safeParse({ ...env, GATEWAY_JWT_KEY: short })

    expect(parsed.error?.issues.map(({ path, message }) => [path.join('.'), message])).toEqual([
      ['GATEWAY_JWT_KEY', 'must be at least 64 characters, such as openssl rand -hex 64'],
    ])
    expect(parsed.error?.message).not.toContain(short)
    expect(JSON.stringify(parsed.error?.issues)).not.toContain(short)
  })

  it('takes a key of 64 characters', () => {
    expect(gatewayConfig.parse(env).GATEWAY_JWT_KEY).toBe(key)
  })
})
