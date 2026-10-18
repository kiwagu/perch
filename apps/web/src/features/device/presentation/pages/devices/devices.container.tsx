import { useEffect, useState } from 'react'

import { useT } from '@workspace/i18n'

import type { DeviceView } from '../../../../../platform/devices.port'
import { useService } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { DEVICES_SERVICE } from '../../../application/devices.service'

import { type DeviceItem, DevicesView } from './devices.view'

export function DevicesContainer() {
  const devices = useService(DEVICES_SERVICE)
  const notify = useNotify()
  const t = useT()
  const [list, setList] = useState<readonly DeviceView[] | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [reads, setReads] = useState(0)

  // The devices are read when the page opens, and again after a sign-out that did not come back
  // with them.
  useEffect(() => {
    let live = true

    void devices.list().match(
      (read) => {
        if (live) {
          setList(read)
        }
      },
      () => {
        if (live) {
          notify({ testId: 'device.notice', text: t('device.notice.read-failed') })
        }
      },
    )

    return () => {
      live = false
    }
  }, [devices, reads, notify, t])

  const failed = () => {
    setPending(false)
    notify({ testId: 'device.notice', text: t('device.notice.sign-out-failed') })
  }

  // Another device's sign-out comes back with the list read again (this device signs out from the
  // profile). A sign-out that failed reads the list again, unless the gateway is out of reach: a
  // read would fail too, and its notice would replace the one that says the sign-out failed.
  const revoke = (device: DeviceItem) => {
    setPending(true)
    void devices.revoke(device).match(
      (outcome) => {
        setPending(false)

        if (outcome.kind === 'listed') {
          setList(outcome.devices)
        } else {
          setReads((count) => count + 1)
        }
      },
      (error) => {
        failed()

        if (error.code !== 'data:OFFLINE') {
          setReads((count) => count + 1)
        }
      },
    )
  }

  // The gateway closes this device's channel as well, and the session signs the device out on
  // that, which sends the page to sign-in: the buttons wait for it.
  const signOutEverywhere = () => {
    setPending(true)
    void devices.signOutEverywhere().match(() => undefined, failed)
  }

  return (
    <DevicesView
      devices={list}
      pending={pending}
      onRevoke={revoke}
      onSignOutEverywhere={signOutEverywhere}
    />
  )
}
