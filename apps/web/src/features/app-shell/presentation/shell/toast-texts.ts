import type { ToastWords } from '../../../../platform/toasts'

/**
 * The tone and the words of each code of `app-shell.toast`, the words by their literal key. The
 * contract derives a code for each model action a flow invokes, the success of that action; its
 * words are the one thing written for it here.
 */
export const TOAST_TEXTS: ToastWords = {
  'note-created': { tone: 'success', text: (t) => t('app.shell.toast.note-created') },
  'note-updated': { tone: 'success', text: (t) => t('app.shell.toast.note-updated') },
  'note-deleted': { tone: 'success', text: (t) => t('app.shell.toast.note-deleted') },
}
