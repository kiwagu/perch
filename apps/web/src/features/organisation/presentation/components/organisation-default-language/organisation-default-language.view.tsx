import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES, useT } from '@workspace/i18n'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type { OrganisationEvent } from '../../../application/organisation-machine'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'

/**
 * The organisation's default language, which an account its invitation creates starts in: a select
 * of the supported languages with none chosen while the organisation has none, the button that
 * removes it while one is set, and why the last change was refused.
 */
export function OrganisationDefaultLanguage(props: {
  /** The organisation's default language; none while it has none. */
  readonly locale: Locale | undefined
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onChoose: (locale: Locale) => void
  readonly onClear: () => void
}) {
  const t = useT()
  const options = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: locale === 'en' ? t('app.shell.locale.en') : t('app.shell.locale.es'),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.default-language.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <OptionSelect
          label={t('organisation.default-language.label')}
          value={props.locale}
          placeholder={t('organisation.default-language.none')}
          options={options}
          onChange={props.onChoose}
          disabled={
            !props.can({
              type: 'organisation.settings.locale-select',
              locale: props.locale ?? DEFAULT_LOCALE,
            })
          }
          testId="organisation.settings.locale-select"
        />
        <OrganisationErrorLine code={props.error} testId="organisation.settings.error" />
        {props.locale === undefined ? null : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={!props.can({ type: 'organisation.settings.clear-button' })}
            onClick={props.onClear}
            data-testid="organisation.settings.clear-button"
          >
            {t('organisation.default-language.clear')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
