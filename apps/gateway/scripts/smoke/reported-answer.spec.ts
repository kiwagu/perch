import { describe, expect, it } from 'vitest'

import { reported } from './reported-answer'

/** What marks a session token and an account's email wherever they could go. */
const MARKED = /MARKER|marker-ann/i

describe('reported', () => {
  it('names the status and a code the gateway or Better Auth answers', () => {
    expect(reported({ status: 429, body: { code: 'rate-limited' } })).toBe('429 rate-limited')
    expect(reported({ status: 403, body: { code: 'EMAIL_NOT_VERIFIED', message: 'x' } })).toBe(
      '403 EMAIL_NOT_VERIFIED',
    )
    expect(reported({ status: 202, body: undefined })).toBe('202 with no body')
  })

  it('prints nothing of a session, an email or a code it does not list', () => {
    const answers = [
      {
        status: 200,
        body: { token: 'tok_MARKER_0123', user: { email: 'marker-ann@example.test' } },
      },
      { status: 200, body: { token: null, user: { email: 'marker-ann@example.test' } } },
      { status: 400, body: { code: 'tok_MARKER_0123' } },
      { status: 400, body: { code: 'marker-ann@example.test' } },
      { status: 500, body: 'failed for marker-ann@example.test with tok_MARKER_0123' },
    ]

    for (const answer of answers) {
      expect(reported(answer)).toMatch(new RegExp(`^${answer.status} `))
      expect(reported(answer)).not.toMatch(MARKED)
    }
  })
})
