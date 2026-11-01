/**
 * The gateway's device routes over HTTP, called with the device's session token and its id
 * (`X-Perch-Device`): the identity's devices, signing one out, and signing out everywhere.
 */

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { DevicesPort, DeviceView } from '../platform/devices.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'

/** A device as `GET /devices` lists it, its times as ISO strings. */
const listedDevice = z.object({
  id: idSchemas.device_session.schema,
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  current: z.boolean(),
})

const listed = z.object({ devices: z.array(listedDevice) })

function deviceView(device: z.infer<typeof listedDevice>): DeviceView {
  return {
    id: device.id,
    label: device.label,
    createdAt: new Date(device.createdAt),
    lastSeenAt: new Date(device.lastSeenAt),
    ...(device.revokedAt === null ? {} : { revokedAt: new Date(device.revokedAt) }),
    current: device.current,
  }
}

/**
 * `GET <baseUrl>/devices`, `DELETE <baseUrl>/devices/:id` and
 * `POST <baseUrl>/auth/sign-out-everywhere`. A refusal fails as `data:WRITE_REJECTED` with the
 * gateway's code (`no-such-device`); any other answer but success names its status only.
 */
export function devicesApi(baseUrl: string, deps: BearerDeps): DevicesPort {
  const calls = bearerCalls(baseUrl, deps)

  return {
    list: () =>
      calls.json('/devices', 'GET', listed).map((answer) => answer.devices.map(deviceView)),
    revoke: (id) => calls.empty(`/devices/${encodeURIComponent(id)}`, 'DELETE'),
    signOutEverywhere: () => calls.empty('/auth/sign-out-everywhere', 'POST'),
  }
}
