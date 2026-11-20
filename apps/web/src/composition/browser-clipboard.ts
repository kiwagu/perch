import { errAsync, ResultAsync } from 'neverthrow'

import type { ClipboardPort } from '../platform/clipboard.port'

/**
 * The clipboard of a browser, over `navigator.clipboard.writeText`. A page that is not a secure
 * context has no clipboard (`undefined`): a write then fails and says so, and the browser's own
 * refusal (no permission, no focus) fails it too.
 */
export function browserClipboard(clipboard: Clipboard | undefined): ClipboardPort {
  return {
    write: (text) =>
      clipboard === undefined
        ? errAsync({
            code: 'clipboard:UNAVAILABLE',
            message: 'this page has no clipboard: the browser offers one to secure pages only',
          })
        : ResultAsync.fromPromise(clipboard.writeText(text), () => ({
            code: 'clipboard:REFUSED' as const,
            message: 'the browser refused to write to the clipboard',
          })),
  }
}
