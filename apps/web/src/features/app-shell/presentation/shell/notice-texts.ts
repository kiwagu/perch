import type { Texts } from '../../../../platform/texts'

/** The words of each code of `app-shell.notice-message`, each by its literal key. */
export const NOTICE_TEXTS: Texts = {
  welcome: (t) => t('user.sign-in.welcome'),
  'profile-saved': (t) => t('user.profile.saved'),
  invited: (t) => t('organisation.invite.invited'),
  'devices-read-failed': (t) => t('device.notice.read-failed'),
  'device-sign-out-failed': (t) => t('device.notice.sign-out-failed'),
  'change-rejected': (t) => t('app.shell.rejected'),
  'changes-reloaded': (t) => t('app.shell.reloaded'),
  'locale-not-stored': (t) => t('app.shell.locale-not-stored'),
}
