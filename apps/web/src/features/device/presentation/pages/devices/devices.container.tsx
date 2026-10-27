import { useEffect, useMemo, useRef, useState } from 'react'

import type { DeviceView } from '../../../../../platform/devices.port'
import { useService } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { createDevicesMachine } from '../../../application/devices.machine'
import { DEVICES_SERVICE } from '../../../application/devices.service'

import { DevicesView } from './devices.view'

export function DevicesContainer() {
  const devices = useService(DEVICES_SERVICE)
  const notify = useNotify()
  const [list, setList] = useState<readonly DeviceView[] | undefined>(undefined)
  const [reads, setReads] = useState(0)
  // The shell's `notify` changes when it clears the notice, as the account signs out: the read
  // must not run again for that, and raises through the one taken when it started, which a
  // reply after the sign-out finds spent.
  const latestNotify = useRef(notify)

  latestNotify.current = notify

  // The devices are read when the page opens, and again after a sign-out that did not come back
  // with them.
  useEffect(() => {
    let live = true
    const raise = latestNotify.current

    void devices.list().match(
      (read) => {
        if (live) {
          setList(read)
        }
      },
      () => {
        if (live) {
          raise({ code: 'devices-read-failed', text: (t) => t('device.notice.read-failed') })
        }
      },
    )

    return () => {
      live = false
    }
  }, [devices, reads])

  // Another device's sign-out comes back with the list read again (this device signs out from the
  // profile). A sign-out that failed reads the list again, unless the gateway is out of reach: a
  // read would fail too, and its notice would replace the one that says the sign-out failed. Once
  // the gateway signed every device out, the session has signed this one out too.
  const machine = useMemo(
    () =>
      createDevicesMachine({
        revoke: (device) =>
          devices
            .revoke({ id: device })
            .andTee((outcome) => {
              if (outcome.kind === 'listed') {
                setList(outcome.devices)
              } else {
                setReads((count) => count + 1)
              }
            })
            .orTee((error) => {
              if (error.code !== 'data:OFFLINE') {
                setReads((count) => count + 1)
              }
            }),
        signOutEverywhere: () => devices.signOutEverywhere(),
      }),
    [devices],
  )
  const { state, send, actor } = useScreenMachine(machine)

  // The effects of the flow on the shell: its notice (the hook runs the move to sign-in, and the
  // session leaves the sign-in page its own word).
  useEffect(() => {
    const shown = actor.on('show', ({ codes }) => {
      if (codes.includes('device-sign-out-failed')) {
        notify({ code: 'device-sign-out-failed', text: (t) => t('device.notice.sign-out-failed') })
      }
    })

    return () => shown.unsubscribe()
  }, [actor, notify])

  return (
    <DevicesView
      devices={list}
      can={(event) => state.can(event)}
      confirming={state.matches('confirming')}
      onRevoke={(device) => send({ type: 'device.list.revoke-button', device: device.id })}
      onOpenEverywhere={() => send({ type: 'device.everywhere.open-button' })}
      onSignOutEverywhere={() => send({ type: 'device.everywhere.dialog.confirm-button' })}
      onCancelEverywhere={() => send({ type: 'device.everywhere.dialog.cancel-button' })}
    />
  )
}
