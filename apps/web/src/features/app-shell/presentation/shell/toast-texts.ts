import type { ToastWords } from '../../../../platform/toasts'

/**
 * The tone and the words of each code of `app-shell.toast`, the words by their literal key. The
 * contract derives a code for each operation a flow runs, its outcome: an action of the model,
 * or a platform action the platform's `toasts` map lists; its words are the one thing written
 * for it here.
 */
export const TOAST_TEXTS: ToastWords = {
  'note-created': { tone: 'success', text: (t) => t('app.shell.toast.note-created') },
  'note-updated': { tone: 'success', text: (t) => t('app.shell.toast.note-updated') },
  'note-deleted': { tone: 'success', text: (t) => t('app.shell.toast.note-deleted') },
  'organisation-created': {
    tone: 'success',
    text: (t) => t('app.shell.toast.organisation-created'),
  },
  'member-removed': { tone: 'success', text: (t) => t('app.shell.toast.member-removed') },
  invited: { tone: 'success', text: (t) => t('app.shell.toast.invited') },
  'invitation-revoked': { tone: 'success', text: (t) => t('app.shell.toast.invitation-revoked') },
  'role-changed': { tone: 'success', text: (t) => t('app.shell.toast.role-changed') },
  'link-copied': { tone: 'success', text: (t) => t('app.shell.toast.link-copied') },
  'invitation-accepted': {
    tone: 'success',
    text: (t) => t('app.shell.toast.invitation-accepted'),
  },
  'invitation-declined': {
    tone: 'success',
    text: (t) => t('app.shell.toast.invitation-declined'),
  },
  'profile-saved': { tone: 'success', text: (t) => t('app.shell.toast.profile-saved') },
  'device-signed-out': { tone: 'success', text: (t) => t('app.shell.toast.device-signed-out') },
  'password-changed': { tone: 'success', text: (t) => t('app.shell.toast.password-changed') },
}
