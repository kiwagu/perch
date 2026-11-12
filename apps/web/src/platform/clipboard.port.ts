import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

/** Why the clipboard took no text: the device has none to offer, or the browser refused to write. */
export interface ClipboardError {
  readonly code: 'clipboard:UNAVAILABLE' | 'clipboard:REFUSED'
  readonly message: string
}

/** The clipboard of the device the app runs on: the text to hand to another application. */
export interface ClipboardPort {
  /** Puts `text` on the clipboard. */
  write(text: string): ResultAsync<void, ClipboardError>
}

export const CLIPBOARD = token<ClipboardPort>('Clipboard')
