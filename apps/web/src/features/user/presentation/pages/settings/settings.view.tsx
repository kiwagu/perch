import { type Locale, SUPPORTED_LOCALES, useT } from '@workspace/i18n'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import { THEMES, type Theme } from '../../../../../platform/theme'

export interface SettingsViewProps {
  readonly theme: Theme
  readonly locale: Locale
  /** Whether the screen's flow takes a theme now: none before the settings arrive, or while one is stored. */
  readonly canChooseTheme: boolean
  /** Whether the screen's flow takes a language now: none before the settings arrive, or while one is stored. */
  readonly canChooseLocale: boolean
  readonly onTheme: (theme: Theme) => void
  readonly onLocale: (locale: Locale) => void
}

/** The theme and the language of the account, each applied as it is chosen. */
export function SettingsView(props: SettingsViewProps) {
  const t = useT()
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
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 data-testid="user.settings.heading">{t('user.settings.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OptionSelect
          label={t('user.settings.theme')}
          value={props.theme}
          options={themes}
          onChange={props.onTheme}
          disabled={!props.canChooseTheme}
          testId="user.settings.theme-select"
          holdsInput={false}
        />
        <OptionSelect
          label={t('user.settings.locale')}
          value={props.locale}
          options={locales}
          onChange={props.onLocale}
          disabled={!props.canChooseLocale}
          testId="user.settings.locale-select"
          holdsInput={false}
        />
      </CardContent>
    </Card>
  )
}
