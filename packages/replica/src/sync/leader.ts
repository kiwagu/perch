export interface LockManagerLike {
  request(
    name: string,
    options: { readonly steal?: boolean; readonly signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>
}

export interface Leadership {
  isLeader(): boolean
  onChange(listener: (leader: boolean) => void): () => void
  /** Takes the leadership at once, even from another tab (sign-out runs where the user clicked). */
  takeOver(): Promise<void>
  stop(): void
}

/** The lock that makes one tab of this identity the sync leader. */
export function lockName(identity: string): string {
  return `perch-sync:${identity}`
}

interface Attempt {
  readonly controller: AbortController
  readonly release: () => void
  readonly started: Promise<void>
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

/**
 * Holds the lock `name` for as long as this tab leads. A lock stolen by another tab puts this one
 * back in the queue; any other failure of the lock manager ends the attempts. Undefined when the
 * browser has no Web Locks: such a browser does not sync at all, and the caller says so.
 */
export function leadership(
  locks: LockManagerLike | undefined,
  name: string,
): Leadership | undefined {
  if (locks === undefined) return undefined
  const manager = locks
  const listeners = new Set<(leader: boolean) => void>()
  let leader = false
  let stopped = false
  let current: Attempt | undefined

  function notify(value: boolean): void {
    for (const listener of [...listeners]) listener(value)
  }

  function set(value: boolean): void {
    if (leader === value) return
    leader = value
    notify(value)
  }

  function attempt(steal: boolean): Attempt {
    const controller = new AbortController()
    let release: () => void = () => undefined
    let started: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const self: Attempt = { controller, release, started: running }

    current = self
    manager
      .request(name, steal ? { steal } : { signal: controller.signal }, async () => {
        if (current !== self || stopped) return
        set(true)
        started()
        await released
      })
      .then(
        () => {
          if (current === self) set(false)
        },
        (error: unknown) => {
          release()
          started()
          if (current !== self || stopped) return
          if (isAbortError(error)) {
            set(false)
            attempt(false)

            return
          }
          current = undefined
          stopped = true
          leader = false
          notify(false)
        },
      )

    return self
  }

  attempt(false)

  return {
    isLeader: () => leader,
    onChange: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    takeOver: async () => {
      if (stopped || leader) return
      current?.controller.abort()
      await attempt(true).started
    },
    stop: () => {
      stopped = true
      current?.controller.abort()
      current?.release()
      current = undefined
      set(false)
    },
  }
}
