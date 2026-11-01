import { describe, expect, it } from 'vitest'

import { gatewayConfig } from './config'

const env = {
  GATEWAY_PORT: '8080',
  SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
  GATEWAY_SURREAL_USER: 'gateway',
  GATEWAY_SURREAL_PASS: 'gateway-pass',
  GATEWAY_AUTH_SECRET: 'stand-only-auth-secret-not-for-any-deployment-0123456789abcdef',
  GATEWAY_PUBLIC_URL: 'https://localhost:5443',
  PATH: '/usr/bin',
}

describe('gatewayConfig', () => {
  it('parses a valid environment', () => {
    expect(gatewayConfig.parse(env)).toEqual({
      GATEWAY_PORT: 8080,
      SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-pass',
      GATEWAY_AUTH_SECRET: env.GATEWAY_AUTH_SECRET,
      GATEWAY_PUBLIC_URL: 'https://localhost:5443',
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
        [
          'SURREAL_URL',
          'must be a ws:// or wss:// address: the gateway holds one WebSocket to the directory',
        ],
      ])
    }
  })
})

describe('gatewayConfig.GATEWAY_AUTH_SECRET', () => {
  it('is required', () => {
    const { GATEWAY_AUTH_SECRET: _missing, ...partial } = env
    const parsed = gatewayConfig.safeParse(partial)

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'GATEWAY_AUTH_SECRET',
    ])
  })

  it('refuses a secret shorter than 32 characters, naming the rule and not the value', () => {
    const parsed = gatewayConfig.safeParse({ ...env, GATEWAY_AUTH_SECRET: 'short' })

    expect(parsed.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['GATEWAY_AUTH_SECRET', 'must be at least 32 characters, such as openssl rand -hex 32'],
    ])
  })
})

describe('gatewayConfig.GATEWAY_PUBLIC_URL', () => {
  it('takes the front origin and strips a trailing slash', () => {
    expect(
      gatewayConfig.parse({ ...env, GATEWAY_PUBLIC_URL: 'https://localhost:5443/' })
        .GATEWAY_PUBLIC_URL,
    ).toBe('https://localhost:5443')
  })

  it('refuses an address that is not http(s)', () => {
    expect(gatewayConfig.safeParse({ ...env, GATEWAY_PUBLIC_URL: 'ws://localhost' }).success).toBe(
      false,
    )
  })
})
