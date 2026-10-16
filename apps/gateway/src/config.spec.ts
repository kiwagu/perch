import { describe, expect, it } from 'vitest'

import { gatewayConfig, httpRpcUrl } from './config'

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

describe('httpRpcUrl', () => {
  it('turns the WebSocket address of the database into its HTTP RPC endpoint', () => {
    expect(httpRpcUrl('ws://127.0.0.1:8000/rpc')).toBe('http://127.0.0.1:8000/rpc')
    expect(httpRpcUrl('wss://db.example.test')).toBe('https://db.example.test/rpc')
  })
})
