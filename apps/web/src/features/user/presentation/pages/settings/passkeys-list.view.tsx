import { useFormats, useT } from '@workspace/i18n'
import type { PasskeyId } from '@workspace/ids'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/ui/card'

import type { PasskeyView } from '../../../../../platform/passkeys.port'
import type { SettingsEvent } from '../../../application/settings/settings-machine'

/** What the list knows of the passkeys: not yet, not at all, or the passkeys read. */
export type PasskeysRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly PasskeyView[] }

export interface PasskeysListViewProps {
  readonly passkeys: PasskeysRead
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** Whether the flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: SettingsEvent) => boolean
  readonly onAdd: () => void
  readonly onRemove: (passkey: PasskeyId) => void
}

/** The codes of `user.settings.passkeys.error`. */
type PasskeysErrorCode = 'passkey-cancelled' | 'failed'

/** The contract code of a failure, with its text. */
function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { readonly code: PasskeysErrorCode; readonly text: string } {
  return code === 'data:PASSKEY_CANCELLED'
    ? { code: 'passkey-cancelled', text: t('user.settings.passkeys.error.passkey-cancelled') }
    : { code: 'failed', text: t('user.settings.passkeys.error.failed') }
}

/**
 * The account's passkeys, the earliest added first, each by when it was added and with the button
 * that removes it, and the button that has the browser make another.
 */
export function PasskeysListView(props: PasskeysListViewProps) {
  const t = useT()
  const when = useFormats().dateTime
  const items = props.passkeys.status === 'ready' ? props.passkeys.items : []
  const state =
    props.passkeys.status === 'ready' && items.length === 0 ? 'empty' : props.passkeys.status
  const error = props.error ? errorOf(t, props.error) : undefined

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h2>{t('user.settings.passkeys.title')}</h2>
        </CardTitle>
        <CardDescription>{t('user.settings.passkeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul
          className="flex flex-col gap-3"
          data-testid="user.settings.passkeys.list"
          data-state={state}
        >
          {items.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="user.settings.passkeys.passkey-item"
              data-id={passkey.id}
            >
              <span>
                <span className="text-muted-foreground">{t('user.settings.passkeys.added')} </span>
                <time
                  dateTime={passkey.createdAt.toISOString()}
                  data-testid="user.settings.passkeys.added-cell"
                >
                  {when(passkey.createdAt)}
                </time>
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !props.can({
                    type: 'user.settings.passkeys.remove-button',
                    passkey: passkey.id,
                  })
                }
                onClick={() => props.onRemove(passkey.id)}
                data-testid="user.settings.passkeys.remove-button"
              >
                {t('user.settings.passkeys.remove')}
              </Button>
            </li>
          ))}
        </ul>
        {state === 'loading' ? (
          <p className="text-muted-foreground" role="status">
            {t('user.settings.passkeys.loading')}
          </p>
        ) : null}
        {state === 'empty' ? (
          <p className="text-muted-foreground">{t('user.settings.passkeys.empty')}</p>
        ) : null}
        {state === 'error' ? (
          <p className="text-destructive" role="alert">
            {t('user.settings.passkeys.unavailable')}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription data-testid="user.settings.passkeys.error" data-code={error.code}>
              {error.text}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="button"
          disabled={!props.can({ type: 'user.settings.passkeys.add-button' })}
          onClick={props.onAdd}
          data-testid="user.settings.passkeys.add-button"
        >
          {t('user.settings.passkeys.add')}
        </Button>
      </CardContent>
    </Card>
  )
}
