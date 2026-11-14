import { match } from 'ts-pattern'

import { type Locale, SUPPORTED_LOCALES, useLocale, useT } from '@workspace/i18n'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'

import type { SyncStatus } from '../../../../../platform/sync-status.port'
import { THEMES, type Theme } from '../../../../../platform/theme'

export interface HeaderActionsProps {
  readonly signedIn: boolean
  /** The code the state of the sync shows; none for a guest, or while the account's data opens. */
  readonly sync?: SyncStatus | undefined
  /** The theme this device shows. */
  readonly theme: Theme
  /** Whether the frame's flow takes a theme choice now: the select is enabled while it does. */
  readonly canChooseTheme: boolean
  readonly onThemeChange: (theme: Theme) => void
  /** Whether the frame's flow takes a language choice now: the select is enabled while it does. */
  readonly canChooseLocale: boolean
  readonly onLocaleChange: (locale: Locale) => void
}

/** The header's actions: the state of this device's sync, or a guest's theme and language. */
export function HeaderActions(props: HeaderActionsProps) {
  const t = useT()
  const locale = useLocale()
  const themes = THEMES.map((theme) => ({
    value: theme,
    label:
      theme === 'light'
        ? t('app.shell.theme.light')
        : theme === 'dark'
          ? t('app.shell.theme.dark')
          : t('app.shell.theme.system'),
  }))
  const locales = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: locale === 'en' ? t('app.shell.locale.en') : t('app.shell.locale.es'),
  }))

  return (
    <>
      {/* A signed-in account sees the state of this device's sync; on a phone it takes two
          short lines at most, so the header never scrolls sideways. */}
      {props.sync ? (
        <p
          className="max-w-24 text-right text-xs leading-tight text-muted-foreground sm:max-w-none"
          role="status"
          data-testid="app-shell.sync-message"
          data-code={props.sync}
        >
          {match(props.sync)
            .with('synced', () => t('app.shell.sync.synced'))
            .with('sending', () => t('app.shell.sync.sending'))
            .with('connecting', () => t('app.shell.sync.connecting'))
            .with('offline', () => t('app.shell.sync.offline'))
            .with('sync-stopped', () => t('app.shell.sync.sync-stopped'))
            .exhaustive()}
        </p>
      ) : null}
      {/* A guest chooses the theme of this device here; a signed-in account chooses its own on
          its settings screen, and the frame shows it. */}
      {props.signedIn ? null : (
        <OptionSelect
          label={t('app.shell.theme')}
          value={props.theme}
          options={themes}
          onChange={props.onThemeChange}
          disabled={!props.canChooseTheme}
          testId="app-shell.theme-select"
          holdsInput={false}
        />
      )}
      {/* A guest chooses the language here; a signed-in account does on its settings screen. */}
      {props.signedIn ? null : (
        <OptionSelect
          label={t('app.shell.locale')}
          value={locale}
          options={locales}
          onChange={props.onLocaleChange}
          disabled={!props.canChooseLocale}
          testId="app-shell.locale-select"
          holdsInput={false}
        />
      )}
    </>
  )
}
