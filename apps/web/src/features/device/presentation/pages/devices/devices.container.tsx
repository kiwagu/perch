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
  // Set when another device's sign-out came back with the devices: the read the flow asks for
  // after it takes them from that answer.
  const answered = useRef(false)
  // The shell's `notify` changes when it clears the notice, as the account signs out: the read
  // must not run again for that, and raises through the one taken when it started, which a
  // reply after the sign-out finds spent.
  const latestNotify = useRef(notify)

  latestNotify.current = notify

  // The devices are read when the page opens, and again each time the flow reads the list.
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
          raise('devices-read-failed')
        }
      },
    )

    return () => {
      live = false
    }
  }, [devices, reads])

  // Another device's sign-out comes back with the devices when the gateway could read them (this
  // device signs out from the profile). Once the gateway signed every device out, the session has
  // signed this one out too.
  const machine = useMemo(
    () =>
      createDevicesMachine({
        revoke: (device) =>
          devices.revoke({ id: device }).andTee((outcome) => {
            if (outcome.kind === 'listed') {
              answered.current = true
              setList(outcome.devices)
            }
          }),
        signOutEverywhere: () => devices.signOutEverywhere(),
      }),
    [devices],
  )
  const { state, send, renders, actor } = useScreenMachine('device', machine)

  // The flow reads the list after a sign-out (none after one that could not reach the gateway):
  // from the sign-out's answer when it came with the devices, else by reading them again.
  useEffect(() => {
    const read = actor.on('read', () => {
      if (answered.current) {
        answered.current = false

        return
      }

      setReads((count) => count + 1)
    })

    return () => read.unsubscribe()
  }, [actor])

  return (
    <DevicesView
      devices={list}
      can={(event) => state.can(event)}
      confirming={renders('device.everywhere.dialog')}
      onRevoke={(device) => send({ type: 'device.list.revoke-button', device: device.id })}
      onOpenEverywhere={() => send({ type: 'device.everywhere.open-button' })}
      onSignOutEverywhere={() => send({ type: 'device.everywhere.dialog.confirm-button' })}
      onCancelEverywhere={() => send({ type: 'device.everywhere.dialog.cancel-button' })}
    />
  )
}
