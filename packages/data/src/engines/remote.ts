import { createRemoteEngines, type Engines } from 'surrealdb'

/** Engines for a SurrealDB server over WebSocket (`ws://`, `wss://`) or HTTP. */
export const remoteEngines = (): Engines => createRemoteEngines()
