import type { LockManagerLike } from '../sync'

type Mode = 'shared' | 'exclusive'

interface Request {
  readonly name: string
  readonly mode: Mode
  readonly callback: () => Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

function abortError(): Error {
  const error = new Error('The lock request is aborted')

  error.name = 'AbortError'

  return error
}

/**
 * Mirrors `navigator.locks`: each name has its holders and its queue. A `shared` request is
 * granted while no exclusive lock of its name is held, an `exclusive` one (the default) once
 * nobody holds its name; requests of a name are granted in the order they were made, so a
 * request waits behind an earlier one that waits. Each callback runs asynchronously after its
 * grant and holds the lock until its promise settles; `steal` rejects the holders of the name
 * with an `AbortError` and is granted at once; an aborted signal takes a waiting request out of
 * the queue. `failWith` makes every later request fail with that error.
 */
export class FakeLocks implements LockManagerLike {
  /** The requests waiting for a grant, of every name, in the order they were made. */
  readonly queue: Request[] = []
  failWith: unknown
  requests = 0
  readonly #held: Request[] = []

  request(
    name: string,
    options: { readonly mode?: Mode; readonly steal?: boolean; readonly signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void> {
    this.requests += 1
    if (this.failWith !== undefined) return Promise.reject(this.failWith)

    return new Promise<void>((resolve, reject) => {
      const request: Request = {
        name,
        mode: options.mode ?? 'exclusive',
        callback,
        resolve,
        reject,
      }

      if (options.steal) {
        for (const holder of this.#held.filter((held) => held.name === name)) {
          this.#held.splice(this.#held.indexOf(holder), 1)
          holder.reject(abortError())
        }
        this.#grant(request)

        return
      }

      if (options.signal?.aborted) {
        reject(abortError())

        return
      }

      this.queue.push(request)
      options.signal?.addEventListener('abort', () => {
        const at = this.queue.indexOf(request)

        if (at < 0) return
        this.queue.splice(at, 1)
        reject(abortError())
        this.#process(name)
      })
      this.#process(name)
    })
  }

  /** Whether a request of `name` (of `mode`, when one is given) waits for its grant. */
  waiting(name: string, mode?: Mode): boolean {
    return this.queue.some(
      (request) => request.name === name && (mode === undefined || request.mode === mode),
    )
  }

  /** Grants the requests at the head of the name's queue for as long as they may be granted. */
  #process(name: string): void {
    for (let next = this.#first(name); next && this.#grantable(next); next = this.#first(name)) {
      this.queue.splice(this.queue.indexOf(next), 1)
      this.#grant(next)
    }
  }

  #first(name: string): Request | undefined {
    return this.queue.find((request) => request.name === name)
  }

  #grantable(request: Request): boolean {
    const holders = this.#held.filter((held) => held.name === request.name)

    return request.mode === 'exclusive'
      ? holders.length === 0
      : holders.every((held) => held.mode === 'shared')
  }

  #grant(request: Request): void {
    this.#held.push(request)
    // The real API runs the callback asynchronously after the grant.
    void Promise.resolve()
      .then(request.callback)
      .then(
        () => this.#release(request, () => request.resolve()),
        (error: unknown) => this.#release(request, () => request.reject(error)),
      )
  }

  /** The callback settled: its request settles (a stolen one already has), and the lock is free. */
  #release(request: Request, settle: () => void): void {
    settle()

    const at = this.#held.indexOf(request)

    if (at < 0) return
    this.#held.splice(at, 1)
    this.#process(request.name)
  }
}
