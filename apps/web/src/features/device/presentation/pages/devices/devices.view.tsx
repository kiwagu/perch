import { useMemo } from 'react'

import { useLocale, useT } from '@workspace/i18n'
import type { DeviceSessionId } from '@workspace/ids'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type { DevicesEvent } from '../../../application/devices.machine'

/** A device of the signed-in identity, as the list shows it. */
export interface DeviceItem {
  readonly id: DeviceSessionId
  readonly label: string
  readonly lastSeenAt: Date
  /** When it was signed out; such a device stays listed for a while. */
  readonly revokedAt?: Date | undefined
  /** This device: it signs out through its session, not from the list. */
  readonly current: boolean
}

export interface DevicesViewProps {
  /** The devices, the earliest signed in first; undefined until they are read. */
  readonly devices: readonly DeviceItem[] | undefined
  /** Whether the page's flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: DevicesEvent) => boolean
  /** The dialog asks whether to sign every device out. */
  readonly confirming: boolean
  readonly onRevoke: (device: DeviceItem) => void
  readonly onOpenEverywhere: () => void
  readonly onSignOutEverywhere: () => void
  readonly onCancelEverywhere: () => void
}

function DeviceRow(props: {
  readonly device: DeviceItem
  readonly when: (date: Date) => string
  readonly can: DevicesViewProps['can']
  readonly onRevoke: DevicesViewProps['onRevoke']
}) {
  const t = useT()
  const { device } = props

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="device.list.session-item"
      data-id={device.id}
      data-state={device.current ? 'current' : device.revokedAt ? 'revoked' : undefined}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-words" data-testid="device.list.label-cell">
            {device.label}
          </span>
          {device.current ? (
            <span
              className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              data-testid="device.list.current-badge"
            >
              {t('device.list.current')}
            </span>
          ) : null}
        </span>
        <span className="text-sm text-muted-foreground" data-testid="device.list.seen-cell">
          {t('device.list.seen', { when: props.when(device.lastSeenAt) })}
        </span>
        {device.revokedAt ? (
          <span className="text-sm text-muted-foreground" data-testid="device.list.revoked-cell">
            {t('device.list.revoked', { when: props.when(device.revokedAt) })}
          </span>
        ) : null}
      </div>
      {device.current || device.revokedAt ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={!props.can({ type: 'device.list.revoke-button', device: device.id })}
          onClick={() => props.onRevoke(device)}
          data-testid="device.list.revoke-button"
        >
          {t('device.list.revoke')}
        </Button>
      )}
    </li>
  )
}

/**
 * The signed-in identity's devices: each with its label and when it was last seen, this device
 * marked; another device signs out from its row, and every device, this one included, after a
 * confirmation.
 */
export function DevicesView(props: DevicesViewProps) {
  const t = useT()
  const locale = useLocale()
  const when = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

    return (date: Date) => format.format(date)
  }, [locale])

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1>{t('device.page.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.devices ? (
          <ul className="flex flex-col gap-4" data-testid="device.list">
            {props.devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                when={when}
                can={props.can}
                onRevoke={props.onRevoke}
              />
            ))}
          </ul>
        ) : (
          <p
            className="text-muted-foreground"
            role="status"
            data-testid="device.page.status"
            data-state="loading"
          >
            {t('device.page.loading')}
          </p>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={!props.can({ type: 'device.everywhere.open-button' })}
          onClick={props.onOpenEverywhere}
          data-testid="device.everywhere.open-button"
        >
          {t('device.everywhere.open')}
        </Button>
        <ConfirmDialog
          open={props.confirming}
          title={t('device.everywhere.title')}
          description={t('device.everywhere.body')}
          confirmLabel={t('device.everywhere.confirm')}
          cancelLabel={t('device.everywhere.cancel')}
          destructive
          onConfirm={props.onSignOutEverywhere}
          onCancel={props.onCancelEverywhere}
          testId="device.everywhere.dialog"
          code="sign-out-everywhere"
        />
      </CardContent>
    </Card>
  )
}
