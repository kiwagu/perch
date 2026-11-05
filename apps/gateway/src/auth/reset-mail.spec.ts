import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import { resetMailer } from './reset-mail'

const IDENTITY = identityIdFactory.create()
const TOKEN = 'tok_MARKER_0123'

/** A mailer whose earlier links end as `ending` answers, recording what it was asked. */
function mailerEnding(ending: 'ends' | 'fails') {
  const asked: string[] = []
  const send = resetMailer({
    links: {
      keepNewest: (identity, token) => {
        asked.push(`keep ${identity} ${token}`)

        return ending === 'ends'
          ? okAsync(undefined)
          : errAsync(dataError('data:WRITE_FAILED', 'the directory is down'))
      },
    },
    mails: {
      resetPassword: (identity, token) => {
        asked.push(`mail ${identity} ${token}`)
      },
    },
  })

  return { asked, send }
}

describe('resetMailer', () => {
  it('ends the earlier links of the account before it starts the mail of the newest', async () => {
    const { asked, send } = mailerEnding('ends')

    await send({ user: { id: IDENTITY, email: 'ann@example.test' }, token: TOKEN })

    expect(asked).toEqual([`keep ${IDENTITY} ${TOKEN}`, `mail ${IDENTITY} ${TOKEN}`])
  })

  it('fails the request, mailing nothing, when the earlier links cannot be ended, naming no token', async () => {
    const { asked, send } = mailerEnding('fails')
    const failure = send({ user: { id: IDENTITY }, token: TOKEN })

    await expect(failure).rejects.toThrow(/^the earlier reset links could not be ended$/)
    expect(asked).toEqual([`keep ${IDENTITY} ${TOKEN}`])
  })

  it('fails the request for an account it cannot read, asking nothing', async () => {
    const { asked, send } = mailerEnding('ends')

    await expect(send({ user: { id: 'not-an-identity' }, token: TOKEN })).rejects.toThrow(
      /^the account of a reset link could not be read$/,
    )
    expect(asked).toEqual([])
  })
})
