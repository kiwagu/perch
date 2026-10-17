import type { LockManagerLike } from '../sync/leader'

interface Waiting {
  readonly callback: () => Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal | undefined
}

function abortError(): Error {
  const error = new Error('The lock request is aborted')

  error.name = 'AbortError'

  return error
}

/**
 * Mirrors `navigator.locks` for one lock name: requests are granted in order, each callback
 * runs asynchronously after its grant, `steal` rejects the old holder with an `AbortError`.
 * `failWith` makes every later request fail with that error.
 */
export class FakeLocks implements LockManagerLike {
  readonly queue: Waiting[] = []
  failWith: unknown
  requests = 0
  private holder: Waiting | undefined

  request(
    _name: string,
    options: { readonly steal?: boolean; readonly signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void> {
    this.requests += 1
    if (this.failWith !== undefined) return Promise.reject(this.failWith)

    return new Promise<void>((resolve, reject) => {
      const waiting: Waiting = { callback, resolve, reject, signal: options.signal }

      if (options.steal) {
        this.holder?.reject(abortError())
        this.grant(waiting)
      } else if (this.holder === undefined) {
        this.grant(waiting)
      } else {
        this.queue.push(waiting)
        options.signal?.addEventListener('abort', () => {
          const at = this.queue.indexOf(waiting)

          if (at < 0) return
          this.queue.splice(at, 1)
          reject(abortError())
        })
      }
    })
  }

  private grant(waiting: Waiting): void {
    this.holder = waiting
    // The real API runs the callback asynchronously after the grant.
    void Promise.resolve()
      .then(waiting.callback)
      .then(() => {
        waiting.resolve()
        if (this.holder !== waiting) return
        this.holder = undefined
        const next = this.queue.shift()

        if (next !== undefined) this.grant(next)
      })
  }
}
