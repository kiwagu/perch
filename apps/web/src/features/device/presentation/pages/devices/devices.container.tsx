import { useEffect, useState } from 'react'

import type { DeviceView } from '../../../../../platform/devices.port'
import { useService } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { DEVICES_SERVICE } from '../../../application/devices.service'

import { type DeviceItem, DevicesView } from './devices.view'

export function DevicesContainer() {
  const devices = useService(DEVICES_SERVICE)
  const notify = useNotify()
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
          notify({ code: 'devices-read-failed', text: (t) => t('device.notice.read-failed') })
        }
      },
    )

    return () => {
      live = false
    }
  }, [devices, reads, notify])

  const failed = () => {
    setPending(false)
    notify({ code: 'device-sign-out-failed', text: (t) => t('device.notice.sign-out-failed') })
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

  // Once the gateway signed every device out, the session has signed this one out too, which
  // sends the page to sign-in.
  const signOutEverywhere = () => {
    setPending(true)
    void devices.signOutEverywhere().match(() => setPending(false), failed)
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
