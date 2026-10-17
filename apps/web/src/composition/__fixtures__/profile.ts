import type { Command, Shape } from '@workspace/data'

import createProfileText from './create-profile.surql'
import profileByIdText from './profile-by-id.surql'

export const createProfile: Command<{
  id: string
  identity: string
  name: string
  email: string
}> = {
  id: 'fixture.createProfile',
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

export const profileById: Shape<{ id: string }, { name: string } | undefined> = {
  id: 'fixture.profileById',
  kind: 'shape',
  text: profileByIdText,
  params: [{ name: 'id', type: 'record<profile>' }],
  tables: ['profile'],
}
