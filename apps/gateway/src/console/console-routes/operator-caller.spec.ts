import { afterEach, describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'

import {
  closeConsoleAuth,
  consoleRequest,
  openConsoleAuth,
  setRole,
  signedUp,
  waitingSignIn,
} from '../__fixtures__/operators'

import { operatorCaller } from './operator-caller'

afterEach(closeConsoleAuth)

/** A request for the list of accounts. */
const listing = (ask: Parameters<typeof consoleRequest>[2]) =>
  consoleRequest('GET', '/console/accounts', ask)

describe('operatorCaller', () => {
  it('answers the operator whose live session the token holds on the device it names', async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })

    expect(await operatorCaller(auth.sessions, listing({ as: ann }))).toMatchObject({
      kind: 'caller',
      identity: ann.identity,
      device: ann.device,
      roles: ['operator'],
      token: ann.token,
    })
  })

  it('refuses an account without the operator role as not-operator', async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test')

    expect(await operatorCaller(auth.sessions, listing({ as: ann }))).toEqual({
      kind: 'not-operator',
    })

    await setRole(auth, ann.identity, 'user')

    expect(await operatorCaller(auth.sessions, listing({ as: ann }))).toEqual({
      kind: 'not-operator',
    })
  })

  it('reads the role with every request: a revoke refuses the next one, a grant admits it', async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })
    const asked = () => operatorCaller(auth.sessions, listing({ as: ann }))

    expect(await asked()).toMatchObject({ kind: 'caller' })

    await setRole(auth, ann.identity, 'user')

    expect(await asked()).toEqual({ kind: 'not-operator' })

    await setRole(auth, ann.identity, 'operator')

    expect(await asked()).toMatchObject({ kind: 'caller', roles: ['operator'] })
  })

  it('refuses a request without a token, or with one no live session holds, as unauthorized', async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })

    expect(await operatorCaller(auth.sessions, listing({ device: ann.device }))).toEqual({
      kind: 'unauthorized',
    })
    expect(await operatorCaller(auth.sessions, listing({ as: ann, token: 'nonsense' }))).toEqual({
      kind: 'unauthorized',
    })
  })

  it("refuses an operator's token from another device than its session's as unauthorized", async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })

    expect(await operatorCaller(auth.sessions, listing({ as: ann, device: 'phone' }))).toEqual({
      kind: 'unauthorized',
    })
  })

  it("refuses an operator's sign-in still waiting for its admission as no session", async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })
    const waiting = await waitingSignIn(auth, ann, 'phone')

    expect(
      await operatorCaller(auth.sessions, listing({ token: waiting, device: 'phone' })),
    ).toEqual({ kind: 'unauthorized' })
  })

  it('refuses a request that names no valid device as a bad request, before any session is read', async () => {
    const auth = await openConsoleAuth()
    const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })
    const read: string[] = []
    const sessions = {
      read: (token: string) => {
        read.push(token)

        return auth.sessions.read(token)
      },
    }

    expect(await operatorCaller(sessions, listing({ as: ann, device: null }))).toEqual({
      kind: 'bad-request',
    })
    expect(await operatorCaller(sessions, listing({ as: ann, device: '' }))).toEqual({
      kind: 'bad-request',
    })
    expect(read).toEqual([])
  })

  it('answers a session that could not be read as a failure', async () => {
    const error = dataError('data:QUERY_FAILED', 'the directory is gone')
    const sessions = { read: async () => ({ kind: 'failed', error }) as const }

    expect(await operatorCaller(sessions, listing({ token: 'token', device: 'laptop' }))).toEqual({
      kind: 'failed',
      error,
    })
  })
})
