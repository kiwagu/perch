import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'
import type { RecordWrite } from '@workspace/replica/server'

import {
  deviceHeaders,
  type OpenedAuth,
  openAuth,
  signUpOn,
} from '../auth/__fixtures__/auth-instance'

import { hubOver, profiledOn } from './__fixtures__/profiles'
import { AccountDirectory } from './account-directory'
import { ProfileNames } from './profile-names'

const ANN = 'ann@example.test'

const opened: OpenedAuth[] = []

afterEach(async () => {
  for (const each of opened.splice(0)) {
    await each.close()
  }
})

/** Ann signed up and verified on a fresh directory, with no profile yet. */
async function annSignedUp() {
  const auth = await openAuth()

  opened.push(auth)

  const { user } = await signUpOn(auth.auth, ANN, deviceHeaders('laptop'))

  return { auth, identity: idSchemas.identity.schema.parse(user.id) }
}

describe('ProfileNames', () => {
  it("writes the name into the account's profile through its private region: logged, projected, and sent to its devices", async () => {
    const { auth, identity } = await annSignedUp()
    const hub = hubOver(auth.local, auth.clock)
    const device = await profiledOn(hub, identity, 'Ann', ANN)
    const names = new ProfileNames({ directory: auth.local, hub })

    expect((await names.rename(identity, 'Ann Smith'))._unsafeUnwrap()).toBe('renamed')
    // Logged after the device's own creation of the profile.
    expect((await hub.heads([privateRegionId(identity)]))._unsafeUnwrap()).toEqual([
      { region: privateRegionId(identity), head: 2 },
    ])
    // Projected into the directory, where the console reads the shown name.
    expect((await new AccountDirectory(auth.local).read(identity))._unsafeUnwrap()?.name).toBe(
      'Ann Smith',
    )
    // The account's device sees it as it sees any change of the profile.
    expect(device.received.at(-1)).toMatchObject({ type: 'updates', head: 2 })
    expect(await device.nameSeen()).toBe('Ann Smith')
  })

  it('answers no-profile, writing nothing, for an account that has no profile yet', async () => {
    const { auth, identity } = await annSignedUp()
    const writes: RecordWrite[] = []
    const names = new ProfileNames({
      directory: auth.local,
      hub: {
        writeRecord: (_region, write) => {
          writes.push(write)

          return errAsync(dataError('data:WRITE_FAILED', 'not asked'))
        },
      },
    })

    expect((await names.rename(identity, 'Ann Smith'))._unsafeUnwrap()).toBe('no-profile')
    expect(writes).toEqual([])
  })

  it('fails as the hub fails, the profile keeping its name', async () => {
    const { auth, identity } = await annSignedUp()
    const hub = hubOver(auth.local, auth.clock)

    await profiledOn(hub, identity, 'Ann', ANN)

    const error = dataError('data:WRITE_REJECTED', 'the write was refused')
    const names = new ProfileNames({
      directory: auth.local,
      hub: { writeRecord: () => errAsync(error) },
    })

    expect((await names.rename(identity, 'Ann Smith'))._unsafeUnwrapErr()).toBe(error)
    expect((await new AccountDirectory(auth.local).read(identity))._unsafeUnwrap()?.name).toBe(
      'Ann',
    )
  })
})
