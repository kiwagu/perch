import { useMemo, useState } from 'react'

import { useLocale, useT } from '@workspace/i18n'
import type { DeviceSessionId } from '@workspace/ids'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/ui/alert-dialog'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

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
  /** A sign-out runs: the buttons wait for it. */
  readonly pending?: boolean
  readonly onRevoke: (device: DeviceItem) => void
  readonly onSignOutEverywhere: () => void
}

function EverywhereConfirmation(props: {
  readonly open: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const t = useT()

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('device.everywhere.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('device.everywhere.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="device.everywhere.cancel">
            {t('device.everywhere.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={props.onConfirm}
            data-testid="device.everywhere.confirm"
          >
            {t('device.everywhere.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeviceRow(props: {
  readonly device: DeviceItem
  readonly when: (date: Date) => string
  readonly pending: boolean
  readonly onRevoke: DevicesViewProps['onRevoke']
}) {
  const t = useT()
  const { device } = props

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2"
      data-testid="device.list.item"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-words" data-testid="device.list.label">
            {device.label}
          </span>
          {device.current ? (
            <span
              className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              data-testid="device.list.current"
            >
              {t('device.list.current')}
            </span>
          ) : null}
        </span>
        <span className="text-sm text-muted-foreground" data-testid="device.list.seen">
          {t('device.list.seen', { when: props.when(device.lastSeenAt) })}
        </span>
        {device.revokedAt ? (
          <span className="text-sm text-muted-foreground" data-testid="device.list.revoked">
            {t('device.list.revoked', { when: props.when(device.revokedAt) })}
          </span>
        ) : null}
      </div>
      {device.current || device.revokedAt ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={props.pending}
          onClick={() => props.onRevoke(device)}
          data-testid="device.list.revoke"
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
  const [confirming, setConfirming] = useState(false)
  const pending = props.pending ?? false
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
                pending={pending}
                onRevoke={props.onRevoke}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground" role="status" data-testid="device.page.status">
            {t('device.page.loading')}
          </p>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => setConfirming(true)}
          data-testid="device.everywhere.open"
        >
          {t('device.everywhere.open')}
        </Button>
        <EverywhereConfirmation
          open={confirming}
          onConfirm={() => {
            setConfirming(false)
            props.onSignOutEverywhere()
          }}
          onCancel={() => setConfirming(false)}
        />
      </CardContent>
    </Card>
  )
}
