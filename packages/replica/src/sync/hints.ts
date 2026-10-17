import { z } from '@workspace/zod'

/**
 * What one tab tells the others: `journal` (it wrote to the local log), `visible` (it came to the
 * foreground), `kick` (sync now) and `settled` (the leader imported something).
 */
export type SyncHint = 'journal' | 'visible' | 'kick' | 'settled'

export interface SyncHints {
  post(hint: SyncHint): void
  on(listener: (hint: SyncHint) => void): () => void
  close(): void
}

type MessageHandler = (event: { readonly data: unknown }) => void

/** The part of `BroadcastChannel` that the hints use. */
export interface HintChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: MessageHandler): void
  removeEventListener(type: 'message', listener: MessageHandler): void
  close(): void
}

const hintMessage = z.object({
  kind: z.literal('perch-sync-hint'),
  hint: z.enum(['journal', 'visible', 'kick', 'settled']),
})

const NO_HINTS: SyncHints = {
  post: () => undefined,
  on: () => () => undefined,
  close: () => undefined,
}

/** Hints between the tabs of one browser; without a channel posting and listening do nothing. */
export function syncHints(channel: HintChannel | undefined): SyncHints {
  if (channel === undefined) return NO_HINTS
  const handlers = new Set<MessageHandler>()
  let closed = false

  return {
    post: (hint) => {
      if (!closed) channel.postMessage({ kind: 'perch-sync-hint', hint })
    },
    on: (listener) => {
      const handler: MessageHandler = (event) => {
        const parsed = hintMessage.safeParse(event.data)

        if (parsed.success) listener(parsed.data.hint)
      }

      handlers.add(handler)
      channel.addEventListener('message', handler)

      return () => {
        handlers.delete(handler)
        channel.removeEventListener('message', handler)
      }
    },
    close: () => {
      if (closed) return
      closed = true
      for (const handler of handlers) channel.removeEventListener('message', handler)
      handlers.clear()
      channel.close()
    },
  }
}
