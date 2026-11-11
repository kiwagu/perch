import { match } from 'ts-pattern'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'

import type { AccountErrorCode } from '../../../application/account-machine/machine'

type Translate = ReturnType<typeof useT>

/** The words of the code an area's error shows. */
export function areaErrorText(t: Translate, code: AccountErrorCode): string {
  return match(code)
    .with('name-required', () => t('console.account.action-error.name-required'))
    .with('name-too-long', () => t('console.account.action-error.name-too-long'))
    .with('email-invalid', () => t('console.account.action-error.email-invalid'))
    .with('email-taken', () => t('console.account.action-error.email-taken'))
    .with('rate-limited', () => t('console.account.action-error.rate-limited'))
    .with('own-account', () => t('console.account.action-error.own-account'))
    .with('verified-before', () => t('console.account.action-error.verified-before'))
    .with('last-admin', () => t('console.account.action-error.last-admin'))
    .with('not-operator', () => t('console.account.action-error.not-operator'))
    .with('account-gone', () => t('console.account.action-error.account-gone'))
    .with('failed', () => t('console.account.action-error.failed'))
    .exhaustive()
}

/** An area's error that concerns no field: it shows above the area's controls. */
export function AreaError(props: { readonly testId: string; readonly code: AccountErrorCode }) {
  const t = useT()

  return (
    <Alert variant="destructive">
      <AlertDescription data-testid={props.testId} data-code={props.code}>
        {areaErrorText(t, props.code)}
      </AlertDescription>
    </Alert>
  )
}
