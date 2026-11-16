/**
 * Profiles in an account's private region on a real region hub, for the console's specs: the hub
 * over a directory, and a device of the account subscribed to its region that creates the profile
 * there as a device's start does, and takes in what the hub sends it.
 */

import { expect, onTestFinished } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { type IdentityId, profileIdFactory } from '@workspace/ids'
import { OWNER_ABILITY } from '@workspace/kernel'
import { type Clock, privateRegionId, RegionDoc } from '@workspace/replica'
import type { ServerMessage } from '@workspace/replica/protocol'
import { RegionHub, singleDatabase } from '@workspace/replica/server'

import { profileCreate } from '../../sync/__fixtures__/profile'

/** A region hub over `directory`, closed when the test finishes; what it reports goes to `errors`. */
export function hubOver(directory: LocalDb, clock: Clock, errors: DataError[] = []): RegionHub {
  const hub = new RegionHub({
    databases: singleDatabase(directory),
    schema: replicaSchema,
    clock,
    onError: (error) => errors.push(error),
  })

  onTestFinished(() => hub.close())

  return hub
}

/** A device of an account, subscribed to its private region, whose profile it created. */
export interface ProfiledDevice {
  /** The profile's id. */
  readonly profile: string
  /** What the hub sent the device, oldest first. */
  readonly received: readonly ServerMessage[]
  /** The profile's name in the device's copy of the region, once it took in what it was sent. */
  nameSeen(): Promise<unknown>
}

/**
 * Subscribes a device of `identity` to its private region on `hub` and creates its profile there,
 * named `name` with `email`, as a device's start does: the hub logs it and projects it into the
 * directory.
 */
export async function profiledOn(
  hub: RegionHub,
  identity: IdentityId,
  name: string,
  email: string,
): Promise<ProfiledDevice> {
  const region = privateRegionId(identity)
  const doc = RegionDoc.inMemory('private', region)
  const profile = profileIdFactory.create()
  const received: ServerMessage[] = []
  const device = {
    id: `device-of-${identity}`,
    send: (message: ServerMessage) => received.push(message),
  }

  ;(
    await hub.subscribe(
      { kind: 'private', id: region },
      { id: identity, ability: OWNER_ABILITY },
      device,
      null,
    )
  )._unsafeUnwrap()

  const created = (await profileCreate(doc, { id: profile, identity, name, email }))._unsafeUnwrap()

  ;(await hub.push(region, device, 1, [created]))._unsafeUnwrap()
  expect(received.findLast((message) => message.type === 'ack')).toMatchObject({ batch: 1 })

  return {
    profile,
    received,
    nameSeen: async () => {
      for (const message of received) {
        if (message.type === 'updates') {
          ;(await doc.importRemote(message.bytes, message.head))._unsafeUnwrap()
        }
      }

      return doc.recordJson(`profile/${profile}`)?.['name']
    },
  }
}
