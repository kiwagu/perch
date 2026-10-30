/**
 * Reads and writes routed by region: a shape over the tenant region's tables reads the current
 * organisation's database, and a command into the tenant region writes that organisation's
 * document; every other shape and command goes to the identity's own database and private
 * region. While no organisation is current, the tenant region's reads and writes refuse,
 * saying so. A watch over the tenant region follows the current organisation: when another one
 * becomes current it stops on the one it watched and starts on the new one, or reports that none
 * is current. Each port is a class in a file of its own.
 */

export { RoutingShapeRunner } from './routing-shape-runner'
export { RoutingWritePath } from './routing-write-path'
