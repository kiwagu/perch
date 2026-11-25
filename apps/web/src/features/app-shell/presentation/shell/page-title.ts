import type { Translate } from '@workspace/i18n'
import { CONTRACT_ROUTES } from '@workspace/kernel'

/**
 * The words of each screen's page title, by the path of its route, one literal key each:
 * `app.title.<screen id>`. `page-titles-contract.spec.ts` holds them to the screens of the contract.
 */
export const PAGE_TITLES: Readonly<Record<string, (t: Translate) => string>> = {
  [CONTRACT_ROUTES['user.sign-in']]: (t) => t('app.title.user.sign-in'),
  [CONTRACT_ROUTES['user.verify-email']]: (t) => t('app.title.user.verify-email'),
  [CONTRACT_ROUTES['user.forgot-password']]: (t) => t('app.title.user.forgot-password'),
  [CONTRACT_ROUTES['user.reset-password']]: (t) => t('app.title.user.reset-password'),
  [CONTRACT_ROUTES['user.confirm-email']]: (t) => t('app.title.user.confirm-email'),
  [CONTRACT_ROUTES['user.delete-account']]: (t) => t('app.title.user.delete-account'),
  [CONTRACT_ROUTES['user.profile']]: (t) => t('app.title.user.profile'),
  [CONTRACT_ROUTES.organisation]: (t) => t('app.title.organisation'),
  [CONTRACT_ROUTES['organisation.invitation']]: (t) => t('app.title.organisation.invitation'),
  [CONTRACT_ROUTES.device]: (t) => t('app.title.device'),
  [CONTRACT_ROUTES['console.users']]: (t) => t('app.title.console.users'),
  [CONTRACT_ROUTES['console.account']]: (t) => t('app.title.console.account'),
  [CONTRACT_ROUTES['user.settings']]: (t) => t('app.title.user.settings'),
  [CONTRACT_ROUTES['not-found']]: (t) => t('app.title.not-found'),
}

/** The browser tab's title for the route at `path`: the screen, then the app; the app alone without one. */
export function pageTitle(path: string | undefined, t: Translate): string {
  const title = path === undefined ? undefined : PAGE_TITLES[path]

  return title ? t('app.title.page', { title: title(t) }) : t('app.shell.title')
}
