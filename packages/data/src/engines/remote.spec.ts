import { describe, expect, it } from 'vitest'

import { wsRpcUrl } from './remote'

describe('wsRpcUrl', () => {
  it('turns any address of a server into its WebSocket RPC endpoint', () => {
    expect(wsRpcUrl('http://127.0.0.1:8010')).toBe('ws://127.0.0.1:8010/rpc')
    expect(wsRpcUrl('https://db.example.test/sql')).toBe('wss://db.example.test/rpc')
    expect(wsRpcUrl('ws://127.0.0.1:8000/rpc')).toBe('ws://127.0.0.1:8000/rpc')
    expect(wsRpcUrl('wss://db.example.test')).toBe('wss://db.example.test/rpc')
  })
})
