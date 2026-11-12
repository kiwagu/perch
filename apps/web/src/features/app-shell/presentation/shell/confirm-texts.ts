import type { Translate } from '@workspace/i18n'

/** What the confirmation says for one code: its title, its body and the label of going on. */
export interface ConfirmWords {
  readonly title: (t: Translate) => string
  readonly body: (t: Translate) => string
  readonly confirm: (t: Translate) => string
}

/**
 * The words of each code of `app-shell.confirmation`, by their literal keys. The contract derives
 * a code for each destructive action a control runs (`<object>-<verb>`, or the platform action's
 * name); its words are the one thing written for it here. Going back says the same for every
 * code (`app.shell.confirm.cancel`).
 */
export const CONFIRM_TEXTS: Readonly<Record<string, ConfirmWords>> = {
  'note-delete': {
    title: (t) => t('app.shell.confirm.note-delete.title'),
    body: (t) => t('app.shell.confirm.note-delete.body'),
    confirm: (t) => t('app.shell.confirm.note-delete.confirm'),
  },
  'organisations-remove': {
    title: (t) => t('app.shell.confirm.organisations-remove.title'),
    body: (t) => t('app.shell.confirm.organisations-remove.body'),
    confirm: (t) => t('app.shell.confirm.organisations-remove.confirm'),
  },
  'organisations-revoke-invitation': {
    title: (t) => t('app.shell.confirm.organisations-revoke-invitation.title'),
    body: (t) => t('app.shell.confirm.organisations-revoke-invitation.body'),
    confirm: (t) => t('app.shell.confirm.organisations-revoke-invitation.confirm'),
  },
  'devices-revoke': {
    title: (t) => t('app.shell.confirm.devices-revoke.title'),
    body: (t) => t('app.shell.confirm.devices-revoke.body'),
    confirm: (t) => t('app.shell.confirm.devices-revoke.confirm'),
  },
  'delete-account': {
    title: (t) => t('app.shell.confirm.delete-account.title'),
    body: (t) => t('app.shell.confirm.delete-account.body'),
    confirm: (t) => t('app.shell.confirm.delete-account.confirm'),
  },
  'accounts-ban': {
    title: (t) => t('app.shell.confirm.accounts-ban.title'),
    body: (t) => t('app.shell.confirm.accounts-ban.body'),
    confirm: (t) => t('app.shell.confirm.accounts-ban.confirm'),
  },
  'accounts-revoke-sessions': {
    title: (t) => t('app.shell.confirm.accounts-revoke-sessions.title'),
    body: (t) => t('app.shell.confirm.accounts-revoke-sessions.body'),
    confirm: (t) => t('app.shell.confirm.accounts-revoke-sessions.confirm'),
  },
  'accounts-remove': {
    title: (t) => t('app.shell.confirm.accounts-remove.title'),
    body: (t) => t('app.shell.confirm.accounts-remove.body'),
    confirm: (t) => t('app.shell.confirm.accounts-remove.confirm'),
  },
}
