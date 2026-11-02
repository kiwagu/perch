import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond } from '../__fixtures__/gateway-fetch'
import {
  EMAIL_MARKER,
  keepsNothingOfTheRejection,
  namesNone,
  PASSWORD_MARKER,
  rejectsCarrying,
  TOKEN_MARKER,
} from '../__fixtures__/rejection'

import { gatewayAuth } from './client'

const BASE = 'https://app.example.test/backend'

/** An answer without a body that accepts the request (202). */
const accepted = () => () => Promise.resolve(new Response(null, { status: 202 }))

describe('gatewayAuth.requestPasswordReset', () => {
  const email = 'Ann@example.test'

  it('asks for the reset mail with the email alone, no credentials and no device', async () => {
    const recorded = fakeFetch(accepted())

    expect((await gatewayAuth(BASE, recorded.fetcher).requestPasswordReset(email)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/request-password-reset`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { email },
      },
    ])
  })

  it('reads 429 as a request to wait, another 4xx as a refusal and a failure as one to ask again', async () => {
    for (const [status, code] of [
      [429, 'data:RATE_LIMITED'],
      [400, 'data:WRITE_REJECTED'],
      [500, 'data:WRITE_FAILED'],
    ] as const) {
      const { fetcher } = fakeFetch(respond(status, { code: 'bad-request' }))
      const refused = (
        await gatewayAuth(BASE, fetcher).requestPasswordReset(email)
      )._unsafeUnwrapErr()

      expect(refused.code).toBe(code)
      namesNone(refused, email, email.toLowerCase())
    }
  })

  it('keeps nothing of a rejected request: no cause, no email', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (await gatewayAuth(BASE, fetcher).requestPasswordReset(EMAIL_MARKER))._unsafeUnwrapErr(),
    )
  })
})

describe('gatewayAuth.resetPassword', () => {
  const token = 'reset-token-1'
  const password = 'Secret-new1'

  it('sets the new password with the token alone, no credentials and no device', async () => {
    const recorded = fakeFetch(noContent())

    expect((await gatewayAuth(BASE, recorded.fetcher).resetPassword(token, password)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/reset-password`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { token, password },
      },
    ])
  })

  it('refuses an empty token as a link that does not work, without asking the gateway', async () => {
    const recorded = fakeFetch(noContent())

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).resetPassword('', password))._unsafeUnwrapErr()
        .code,
    ).toBe('data:LINK_INVALID')
    expect(recorded.sent).toEqual([])
  })

  it.each([
    [400, { code: 'password-rejected' }, 'data:PASSWORD_REJECTED'],
    [400, { code: 'bad-request' }, 'data:WRITE_REJECTED'],
    [401, { code: 'link-expired' }, 'data:LINK_EXPIRED'],
    [401, { code: 'link-invalid' }, 'data:LINK_INVALID'],
    [401, {}, 'data:LINK_INVALID'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ])('reads %s %j as %s, naming neither the token nor the password', async (status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (
      await gatewayAuth(BASE, fetcher).resetPassword(token, password)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, token, password)
  })

  it('keeps nothing of a rejected request: no cause, no token, no password', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (
        await gatewayAuth(BASE, fetcher).resetPassword(TOKEN_MARKER, PASSWORD_MARKER)
      )._unsafeUnwrapErr(),
    )
  })
})

describe('gatewayAuth.changePassword and changeEmail', () => {
  const session = { token: 'session-token-1', device: 'device-1' }
  const change = { currentPassword: 'Secret-old1', password: 'Secret-new1' }
  const email = { email: 'ann.new@example.test', password: 'Secret-old1' }

  it('changes the password with the session token and the device, and nothing else', async () => {
    const recorded = fakeFetch(noContent())

    expect((await gatewayAuth(BASE, recorded.fetcher).changePassword(change, session)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/change-password`,
        method: 'POST',
        authorization: 'Bearer session-token-1',
        device: 'device-1',
        body: change,
      },
    ])
  })

  it('asks to change the email the same way, answered 202', async () => {
    const recorded = fakeFetch(accepted())

    expect((await gatewayAuth(BASE, recorded.fetcher).changeEmail(email, session)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/change-email`,
        method: 'POST',
        authorization: 'Bearer session-token-1',
        device: 'device-1',
        body: email,
      },
    ])
  })

  it.each([
    [400, { code: 'invalid-credentials' }, 'data:INVALID_CREDENTIALS'],
    [400, { code: 'password-rejected' }, 'data:PASSWORD_REJECTED'],
    [400, { code: 'email-invalid' }, 'data:EMAIL_INVALID'],
    [400, { code: 'bad-request' }, 'data:WRITE_REJECTED'],
    [401, { code: 'unauthorized' }, 'data:AUTH_FAILED'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:WRITE_FAILED'],
  ])('reads %s %j as %s, naming no password', async (status, body, code) => {
    for (const asked of [
      (fetcher: Parameters<typeof gatewayAuth>[1]) =>
        gatewayAuth(BASE, fetcher).changePassword(change, session),
      (fetcher: Parameters<typeof gatewayAuth>[1]) =>
        gatewayAuth(BASE, fetcher).changeEmail(email, session),
    ]) {
      const refused = (await asked(fakeFetch(respond(status, body)).fetcher))._unsafeUnwrapErr()

      expect(refused.code).toBe(code)
      namesNone(refused, change.currentPassword, change.password, session.token)
    }
  })

  it('keeps nothing of a rejected request: no cause, no password', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (
        await gatewayAuth(BASE, fetcher).changePassword(
          { currentPassword: PASSWORD_MARKER, password: PASSWORD_MARKER },
          { token: TOKEN_MARKER, device: 'device-1' },
        )
      )._unsafeUnwrapErr(),
    )
  })
})

describe('gatewayAuth.confirmEmail', () => {
  const token = 'confirm-token-1'
  const identity = identityIdFactory.create()

  it('confirms with the token alone, and answers the account and its new email', async () => {
    const recorded = fakeFetch(respond(200, { identity, email: 'ann.new@example.test' }))

    expect((await gatewayAuth(BASE, recorded.fetcher).confirmEmail(token))._unsafeUnwrap()).toEqual(
      { identity, email: 'ann.new@example.test' },
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/confirm-email`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { token },
      },
    ])
  })

  it('refuses an empty token without asking the gateway', async () => {
    const recorded = fakeFetch(respond(200, {}))

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).confirmEmail(''))._unsafeUnwrapErr().code,
    ).toBe('data:LINK_INVALID')
    expect(recorded.sent).toEqual([])
  })

  it.each([
    [200, { identity: 'not-an-id', email: 'x' }, 'data:AUTH_FAILED'],
    [400, { code: 'bad-request' }, 'data:LINK_INVALID'],
    [401, { code: 'link-expired' }, 'data:LINK_EXPIRED'],
    [401, { code: 'link-invalid' }, 'data:LINK_INVALID'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ])('reads %s %j as %s, naming no token', async (status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (await gatewayAuth(BASE, fetcher).confirmEmail(token))._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, token)
  })

  it('keeps nothing of a rejected request: no cause, no token', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (await gatewayAuth(BASE, fetcher).confirmEmail(TOKEN_MARKER))._unsafeUnwrapErr(),
    )
  })
})
