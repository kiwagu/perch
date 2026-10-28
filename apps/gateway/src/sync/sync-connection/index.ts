/** A device's sync connection to the gateway: its WebSocket from the hello to the close. */

export { SyncConnection } from './connection'
/** The end of a device's WebSocket the connection writes to, and what the connection needs. */
export type { SocketLike, SyncConnectionDeps } from './deps'
/** The close of a hello whose renewal a limit refused: the device tries again later. */
export { TRY_AGAIN_LATER } from './hello-keys'
