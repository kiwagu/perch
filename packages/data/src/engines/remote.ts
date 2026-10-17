import { createRemoteEngines, type Engines } from 'surrealdb'

/** Engines for a SurrealDB server over WebSocket (`ws://`, `wss://`) or HTTP. */
export const remoteEngines = (): Engines => createRemoteEngines()

/**
 * A server's WebSocket RPC endpoint for any of its `http(s)://` or `ws(s)://` addresses:
 * `https` and `wss` become `wss`, the others `ws`, and the path is `/rpc`. Sessions and
 * record users need WebSocket, while stand tools are often given the HTTP address.
 */
export function wsRpcUrl(url: string): string {
  const parsed = new URL(url)
  const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:'

  parsed.protocol = secure ? 'wss:' : 'ws:'
  parsed.pathname = '/rpc'

  return parsed.toString()
}
