import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserPasskeyCeremony } from './passkey-ceremony'

/** Options as the gateway answers them, with the challenge and user id in base64url. */
const requestOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'app.example.test',
  userVerification: 'required' as const,
}

const creationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Perch', id: 'app.example.test' },
  user: { id: 'dXNlcg', name: 'ann@example.test', displayName: 'Ann' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
}

/** The `navigator.credentials` call each way of the ceremony goes through. */
type Way = 'get' | 'create'

const ways = [
  ['signing in', 'get', () => browserPasskeyCeremony.authenticate(requestOptions)],
  ['adding', 'create', () => browserPasskeyCeremony.register(creationOptions)],
] as const

/** A browser that supports WebAuthn, whose `navigator.credentials` `call` answers as `behave` says. */
function browserWhose(call: Way, behave: (options: CredentialRequestOptions) => Promise<unknown>) {
  vi.stubGlobal('PublicKeyCredential', class {})
  vi.stubGlobal('navigator', { credentials: { [call]: behave } })
}

/** The error a browser rejects with, as its DOMException names it. */
const domError = (name: string, message: string) => new DOMException(message, name)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(ways)('the passkey ceremony while %s', (_, call, ceremony) => {
  it('maps a window that timed out, as the browser rejects it, to data:PASSKEY_CANCELLED', async () => {
    browserWhose(call, () =>
      Promise.reject(
        domError('NotAllowedError', 'The operation either timed out or was not allowed.'),
      ),
    )

    expect((await ceremony())._unsafeUnwrapErr().code).toBe('data:PASSKEY_CANCELLED')
  })

  it('maps a window the person closed or declined to data:PASSKEY_CANCELLED', async () => {
    browserWhose(call, () => Promise.reject(domError('NotAllowedError', 'User declined')))

    expect((await ceremony())._unsafeUnwrapErr().code).toBe('data:PASSKEY_CANCELLED')
  })

  it('maps an AbortError to data:PASSKEY_CANCELLED', async () => {
    browserWhose(call, () => Promise.reject(domError('AbortError', 'aborted')))

    expect((await ceremony())._unsafeUnwrapErr().code).toBe('data:PASSKEY_CANCELLED')
  })

  it("maps the library's own ceremony abort (a newer ceremony replaced it) to data:PASSKEY_CANCELLED", async () => {
    let windows = 0

    // The first window stays open until the library aborts it; the second one is closed.
    browserWhose(call, (options) => {
      windows += 1

      return windows === 1
        ? new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
          })
        : Promise.reject(domError('NotAllowedError', 'second window closed'))
    })

    const first = ceremony()
    const second = ceremony()

    expect((await first)._unsafeUnwrapErr().code).toBe('data:PASSKEY_CANCELLED')
    expect((await second)._unsafeUnwrapErr().code).toBe('data:PASSKEY_CANCELLED')
  })

  it.each([
    ['a browser without the call', domError('NotSupportedError', 'no such authenticator')],
    ['an unexpected error', new Error('boom')],
  ])('maps %s to data:AUTH_FAILED', async (_way, error) => {
    browserWhose(call, () => Promise.reject(error))

    expect((await ceremony())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('maps a browser without WebAuthn to data:AUTH_FAILED, naming it', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    vi.stubGlobal('navigator', {})

    const failed = (await ceremony())._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(String(failed.cause)).toContain('WebAuthn is not supported')
  })
})

describe('the passkey ceremony that completes', () => {
  const bytes = (...values: number[]) => new Uint8Array(values).buffer

  it('answers the assertion of the passkey the browser picked, as the gateway takes it', async () => {
    browserWhose('get', () =>
      Promise.resolve({
        id: 'credential-1',
        rawId: bytes(1, 2, 3),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response: {
          authenticatorData: bytes(4),
          clientDataJSON: bytes(5),
          signature: bytes(6),
          userHandle: bytes(7),
        },
        getClientExtensionResults: () => ({}),
      }),
    )

    expect((await browserPasskeyCeremony.authenticate(requestOptions))._unsafeUnwrap()).toEqual({
      id: 'credential-1',
      rawId: 'AQID',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        authenticatorData: 'BA',
        clientDataJSON: 'BQ',
        signature: 'Bg',
        userHandle: 'Bw',
      },
    })
  })

  it('answers the attestation of the passkey the browser made, as the gateway takes it', async () => {
    browserWhose('create', () =>
      Promise.resolve({
        id: 'credential-2',
        rawId: bytes(1, 2, 3),
        type: 'public-key',
        authenticatorAttachment: 'cross-platform',
        response: { attestationObject: bytes(8), clientDataJSON: bytes(5) },
        getClientExtensionResults: () => ({}),
      }),
    )

    expect((await browserPasskeyCeremony.register(creationOptions))._unsafeUnwrap()).toMatchObject({
      id: 'credential-2',
      rawId: 'AQID',
      type: 'public-key',
      response: { attestationObject: 'CA', clientDataJSON: 'BQ' },
    })
  })
})
