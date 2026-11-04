/**
 * What a device pushes to its identity's private region: edits of the identity's profile,
 * made through the replica's write path on a region document of the device's own and
 * exported as the update bytes a push carries.
 */

import type { ResultAsync } from 'neverthrow'

import type { Command, DataError } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { LoroWritePath, type RegionDoc } from '@workspace/replica'

import createProfileText from './create-profile.surql'
import updateEmailText from './update-email.surql'
import updateNameText from './update-name.surql'

export interface ProfileInput {
  /** The profile's id, `prf_…`. */
  readonly id: string
  /** The owner's identity id, `idn_…`. */
  readonly identity: string
  readonly name: string
  readonly email: string
}

const createProfile: Command<ProfileInput> = {
  id: 'gateway.fixture.createProfile',
  kind: 'command',
  text: createProfileText,
  params: [
    { name: 'id', type: 'record<profile>' },
    { name: 'identity', type: 'record<identity>' },
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
  ],
  tables: ['profile'],
  region: 'private',
  ops: [
    {
      op: 'create',
      record: 'id',
      fields: {
        identity: { param: 'identity' },
        name: { param: 'name' },
        email: { param: 'email' },
      },
    },
  ],
}

const updateName: Command<{ readonly id: string; readonly name: string }> = {
  id: 'gateway.fixture.updateName',
  kind: 'command',
  text: updateNameText,
  params: [
    { name: 'id', type: 'record<profile>' },
    { name: 'name', type: 'string' },
  ],
  tables: ['profile'],
  region: 'private',
  ops: [{ op: 'set', record: 'id', field: 'name', value: { param: 'name' } }],
}

const updateEmail: Command<{ readonly id: string; readonly email: string }> = {
  id: 'gateway.fixture.updateEmail',
  kind: 'command',
  text: updateEmailText,
  params: [
    { name: 'id', type: 'record<profile>' },
    { name: 'email', type: 'string' },
  ],
  tables: ['profile'],
  region: 'private',
  ops: [{ op: 'set', record: 'id', field: 'email', value: { param: 'email' } }],
}

/**
 * Runs `command` on the device's document and answers with the update it made, in a buffer
 * of its own, as a message holds Loro bytes.
 */
export function updateOf<Params>(
  doc: RegionDoc,
  command: Command<Params>,
  params: Params,
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  const from = doc.doc.version()

  return new LoroWritePath(doc, replicaSchema)
    .run(command, params)
    .map(() => new Uint8Array(doc.doc.export({ mode: 'update', from })))
}

/** Creates the identity's profile in the device's document; answers with the update to push. */
export function profileCreate(
  doc: RegionDoc,
  profile: ProfileInput,
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, createProfile, profile)
}

/** Renames the profile in the device's document; answers with the update to push. */
export function profileRename(
  doc: RegionDoc,
  id: string,
  name: string,
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, updateName, { id, name })
}

/**
 * Changes the profile's email in the device's document, a field devices may not change, so the
 * gateway refuses the update; answers with the update to push.
 */
export function profileChangeEmail(
  doc: RegionDoc,
  id: string,
  email: string,
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, updateEmail, { id, email })
}
