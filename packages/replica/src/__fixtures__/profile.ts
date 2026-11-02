import type { Command, Shape } from '@workspace/data'

import type { ReplicaSchema } from '../schema'

import createProfileText from './create-profile.surql'
import deleteProfileText from './delete-profile.surql'
import profileByIdText from './profile-by-id.surql'
import updateBioText from './update-bio.surql'
import updateNameText from './update-name.surql'

export const profileSchema: ReplicaSchema = {
  profile: {
    region: 'private',
    fields: {
      identity: { kind: 'record', table: 'identity' },
      name: { kind: 'plain' },
      email: { kind: 'plain' },
      bio: { kind: 'text' },
    },
  },
}

const id = { name: 'id', type: 'record<profile>' } as const

export const createProfile: Command<{
  id: string
  identity: string
  name: string
  email: string
}> = {
  id: 'user.profile.createProfile',
  kind: 'command',
  text: createProfileText,
  params: [
    id,
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

export const updateName: Command<{ id: string; name: string }> = {
  id: 'user.profile.updateName',
  kind: 'command',
  text: updateNameText,
  params: [id, { name: 'name', type: 'string' }],
  tables: ['profile'],
  region: 'private',
  ops: [{ op: 'set', record: 'id', field: 'name', value: { param: 'name' } }],
}

export const updateBio: Command<{ id: string; bio: string }> = {
  id: 'user.profile.updateBio',
  kind: 'command',
  text: updateBioText,
  params: [id, { name: 'bio', type: 'string' }],
  tables: ['profile'],
  region: 'private',
  ops: [{ op: 'text.update', record: 'id', field: 'bio', value: { param: 'bio' } }],
}

export const deleteProfile: Command<{ id: string }> = {
  id: 'user.profile.deleteProfile',
  kind: 'command',
  text: deleteProfileText,
  params: [id],
  tables: ['profile'],
  region: 'private',
  ops: [{ op: 'delete', record: 'id' }],
}

export interface ProfileRow {
  readonly id: string
  readonly identity: string
  readonly name: string
  readonly email: string
  readonly bio?: string
}

export const profileById: Shape<{ id: string }, ProfileRow | undefined> = {
  id: 'fixture.profile-by-id',
  kind: 'shape',
  text: profileByIdText,
  params: [id],
  tables: ['profile'],
}

export const profileId = 'prf_0000000000000000.01m52pexcp'

export const identityId = 'idn_0000000000000000.01m52pexcp'
