import type { HintChannel } from '../sync/hints'

type Handler = (event: { readonly data: unknown }) => void

/**
 * Like a `BroadcastChannel`, but synchronous: a message reaches every channel on the bus (the
 * tabs of one browser) except the sender; posting on a closed channel throws, as the real one does.
 */
export class FakeHintChannel implements HintChannel {
  closed = false
  readonly handlers = new Set<Handler>()

  constructor(private readonly bus: Set<FakeHintChannel>) {
    bus.add(this)
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('InvalidStateError')
    for (const channel of this.bus) {
      if (channel === this) continue
      for (const handler of [...channel.handlers]) handler({ data: message })
    }
  }

  addEventListener(_type: 'message', listener: Handler): void {
    this.handlers.add(listener)
  }

  removeEventListener(_type: 'message', listener: Handler): void {
    this.handlers.delete(listener)
  }

  close(): void {
    this.closed = true
    this.bus.delete(this)
  }
}
