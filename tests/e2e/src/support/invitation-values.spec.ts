import { describe, expect, it } from 'bun:test'

import { invitationValues } from './invitation-values'

const INVITER = { email: 'ann@example.test', language: 'en' }

describe('invitationValues', () => {
  it('gives the invited email, the inviter as the account, and the languages the test knows', () => {
    expect(invitationValues({ email: 'bob@example.test', inviter: INVITER })).toEqual({
      params: { email: 'bob@example.test' },
      account: INVITER,
    })
    expect(
      invitationValues({
        email: 'bob@example.test',
        inviter: INVITER,
        recipientLanguage: 'es',
        organisationLanguage: 'en',
      }),
    ).toEqual({
      params: { email: 'bob@example.test' },
      account: INVITER,
      recipient: { language: 'es' },
      organisation: { language: 'en' },
    })
  })
})
