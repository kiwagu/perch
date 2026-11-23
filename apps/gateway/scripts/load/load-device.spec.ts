import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

import { ClosedBeforeWelcome } from './closed-before-welcome'
import { type DeviceHandlers, LoadDevice } from './load-device'

const handlers: DeviceHandlers = {
  onUpdates: () => undefined,
  onAck: () => undefined,
  onCompaction: () => undefined,
  onReject: () => undefined,
  onError: () => undefined,
  onClose: () => undefined,
}

/** A gateway that takes sockets and never welcomes; `onOpen` may close one. */
function silentGateway(onOpen?: (socket: Bun.ServerWebSocket<undefined>) => void) {
  const seen = { opened: Promise.withResolvers<void>(), closed: Promise.withResolvers<number>() }
  const server = Bun.serve({
    port: 0,
    fetch: (request, upgrading) =>
      upgrading.upgrade(request) ? undefined : new Response('not a socket', { status: 400 }),
    websocket: {
      open: (socket) => {
        seen.opened.resolve()
        onOpen?.(socket)
      },
      message: () => undefined,
      close: (_socket, code) => seen.closed.resolve(code),
    },
  })

  return { url: `ws://127.0.0.1:${server.port}/sync`, seen, stop: () => server.stop(true) }
}

const stops: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

describe('LoadDevice.open', () => {
  it('rejects with the close code when the socket closes before the welcome', async () => {
    const gateway = silentGateway((socket) => socket.close(CLOSE.revoked, 'revoked'))

    stops.push(gateway.stop)

    const cause = await LoadDevice.open(gateway.url, 'token', handlers, {
      timeoutMs: 30_000,
      device: 'd',
    }).catch((error: unknown) => error)

    expect(cause).toBeInstanceOf(ClosedBeforeWelcome)
    expect(cause instanceof ClosedBeforeWelcome && cause.code).toBe(CLOSE.revoked)
  })

  it('rejects at once when its signal aborts while it waits for the welcome, closing the socket', async () => {
    const gateway = silentGateway()
    const controller = new AbortController()

    stops.push(gateway.stop)

    const opening = LoadDevice.open(gateway.url, 'token', handlers, {
      timeoutMs: 30_000,
      device: 'd',
      signal: controller.signal,
    })

    await gateway.seen.opened.promise
    controller.abort()

    await expect(opening).rejects.toThrow('aborted')
    // The gateway sees its socket close, long before the open's own 30 s timeout.
    expect(await gateway.seen.closed.promise).toBeGreaterThan(0)
  })

  it('opens no socket when its signal is aborted already', async () => {
    const constructed = vi.fn()

    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          constructed()
        }
      },
    )

    await expect(
      LoadDevice.open('ws://127.0.0.1:1/sync', 'token', handlers, {
        timeoutMs: 30_000,
        device: 'd',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow('aborted')
    expect(constructed).not.toHaveBeenCalled()
  })
})
