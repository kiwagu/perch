/**
 * Why a device's open failed when the gateway, or the network, closed the socket before the
 * welcome: `code` is the close code of the socket, which tells a close the gateway ends the
 * device with from any other.
 */
export class ClosedBeforeWelcome extends Error {
  readonly code: number

  constructor(url: string, code: number) {
    super(`${url} closed with ${code} before it welcomed`)
    this.name = 'ClosedBeforeWelcome'
    this.code = code
  }
}
