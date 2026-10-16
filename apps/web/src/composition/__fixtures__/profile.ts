import type { Command, Shape } from '@workspace/data'

import createProfileText from './create-profile.surql'
import profileByIdText from './profile-by-id.surql'

export const createProfile: Command<{ id: string; user: string; name: string; email: string }> = {
  id: 'fixture.createProfile',
  kind: 'command',
  text: createProfileText,
  params: [
    { name: 'id', type: 'record<profile>' },
    { name: 'user', type: 'record<user>' },
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
  ],
  tables: ['profile'],
  region: 'private',
  ops: [
    {
      op: 'create',
      record: 'id',
      fields: { user: { param: 'user' }, name: { param: 'name' }, email: { param: 'email' } },
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
