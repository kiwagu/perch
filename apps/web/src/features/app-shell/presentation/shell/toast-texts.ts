import type { Texts } from '../../../../platform/texts'

/**
 * The words of each code of `app-shell.toast`, each by its literal key. The contract derives a
 * code for each model action a flow invokes; its words are the one thing written for it here.
 */
export const TOAST_TEXTS: Texts = {
  'note-created': (t) => t('app.shell.toast.note-created'),
  'note-updated': (t) => t('app.shell.toast.note-updated'),
  'note-deleted': (t) => t('app.shell.toast.note-deleted'),
}
