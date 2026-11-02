import type { Translate } from '@workspace/i18n'

/**
 * The words of each screen's page title, by the path of its route, one literal key each:
 * `app.title.<screen id>`. `page-titles-contract.spec.ts` holds them to the screens of the contract.
 */
export const PAGE_TITLES: Readonly<Record<string, (t: Translate) => string>> = {
  '/sign-in': (t) => t('app.title.user.sign-in'),
  '/verify-email': (t) => t('app.title.user.verify-email'),
  '/forgot-password': (t) => t('app.title.user.forgot-password'),
  '/reset-password': (t) => t('app.title.user.reset-password'),
  '/me': (t) => t('app.title.user.profile'),
  '/org': (t) => t('app.title.organisation'),
  '/devices': (t) => t('app.title.device'),
  '/settings': (t) => t('app.title.user.settings'),
  '/$': (t) => t('app.title.not-found'),
}

/** The browser tab's title for the route at `path`: the screen, then the app; the app alone without one. */
export function pageTitle(path: string | undefined, t: Translate): string {
  const title = path === undefined ? undefined : PAGE_TITLES[path]

  return title ? t('app.title.page', { title: title(t) }) : t('app.shell.title')
}
