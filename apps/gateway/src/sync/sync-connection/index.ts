/** A device's sync connection to the gateway: its WebSocket from the hello to the close. */

export { SyncConnection } from './connection'
/** The end of a device's WebSocket the connection writes to, and what the connection needs. */
export type { SocketLike, SyncConnectionDeps } from './deps'
/** The codes the registry closes an established socket with, each with its reason. */
export type { EndCode } from './reasons'
/**
 * The close code of a socket the device's newer connection or newer session took over, and the
 * fixed texts a socket is closed with as its reason.
 */
export { REASON, SUPERSEDED } from './reasons'
