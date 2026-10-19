import { describe, expect, it } from 'vitest'

import { gatewayConfig } from './config'

const env = {
  GATEWAY_PORT: '8080',
  SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
  GATEWAY_SURREAL_USER: 'gateway',
  GATEWAY_SURREAL_PASS: 'gateway-pass',
  PATH: '/usr/bin',
}

describe('gatewayConfig', () => {
  it('parses a valid environment', () => {
    expect(gatewayConfig.parse(env)).toEqual({
      GATEWAY_PORT: 8080,
      SURREAL_URL: 'ws://127.0.0.1:8000/rpc',
      GATEWAY_SURREAL_USER: 'gateway',
      GATEWAY_SURREAL_PASS: 'gateway-pass',
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
