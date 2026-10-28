import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import type { AuthPort } from './auth.port'
import { runCommand } from './commands'
import { applySchema } from './local-db'
import { openTestDb, readSchema, TEST_SIGNING_KEY } from './testing'
import type { Command, LocalDb } from './types'

const createIdentity: Command<{ email: string }> = {
  id: 'fixture.create-identity',
  kind: 'command',
  text: readFileSync(new URL('./__fixtures__/create-identity.surql', import.meta.url), 'utf8'),
  params: [{ name: 'email', type: 'string' }],
  tables: ['identity'],
  region: 'server',
  ops: [],
}

const ann = { email: 'ann@example.test', password: 'secret-ann' }

let local: LocalDb
let auth: AuthPort

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  auth = createAuth(local, { access: 'identity', namespace: 'app', database: 'app' })
})

afterEach(async () => {
  await local.close()
})

const another = () => createAuth(local, { access: 'identity', namespace: 'app', database: 'app' })

describe('createAuth', () => {
  it('signs up and reports the account as the current user', async () => {
    const user = (await auth.signUp(ann))._unsafeUnwrap()
    const current = (await auth.current())._unsafeUnwrap()

    expect(user.id).toMatch(/^idn_/)
    expect(user).toEqual({ id: user.id, email: ann.email })
    expect(current).toEqual(user)
    expect(auth.tokens()?.access).toMatch(/^ey/)
    expect(auth.tokens()?.refresh).toMatch(/\S/)
  })

  it('leaves the main session able to write after a sign-up', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const written = await runCommand(local, createIdentity, { email: 'b@example.test' })

    expect(written.isOk()).toBe(true)
  })

  it('signs out', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const signedOut = await auth.signOut()

    expect(signedOut.isOk()).toBe(true)
    expect((await auth.current())._unsafeUnwrap()).toBeUndefined()
    expect(auth.tokens()).toBeUndefined()
  })

  it('signs in with the right password and refuses a wrong one', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)
    expect((await auth.signOut()).isOk()).toBe(true)

    const wrong = await auth.signIn({ email: ann.email, password: 'wrong' })
    const right = await auth.signIn({ email: ann.email, password: ann.password })

    expect(wrong._unsafeUnwrapErr().code).toBe('data:INVALID_CREDENTIALS')
    expect(right._unsafeUnwrap().email).toBe(ann.email)
  })

  it('refuses a second account with the same email', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)
    expect((await auth.signOut()).isOk()).toBe(true)

    const again = await auth.signUp(ann)

    expect(again._unsafeUnwrapErr().code).toBe('data:SIGN_UP_REJECTED')
  })

  it('resumes a session from its access token', async () => {
    const user = (await auth.signUp(ann))._unsafeUnwrap()
    const access = auth.tokens()?.access ?? ''

    expect((await another().resume({ access }))._unsafeUnwrap()).toEqual(user)
  })

  it('resumes from the refresh key and swaps it for a new one, so a spent key stops working', async () => {
    const user = (await auth.signUp(ann))._unsafeUnwrap()
    const saved = auth.tokens() ?? expect.unreachable('tokens after sign-up')
    const resumed = another()

    expect((await resumed.resume(saved))._unsafeUnwrap()).toEqual(user)
    expect(resumed.tokens()?.refresh).toMatch(/\S/)
    expect(resumed.tokens()?.refresh).not.toBe(saved.refresh)
    expect((await another().resume(saved))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('tells listeners about every change of tokens', async () => {
    const seen: Array<string | undefined> = []
    const stop = auth.onTokens((tokens) => seen.push(tokens?.refresh))

    expect((await auth.signUp(ann)).isOk()).toBe(true)
    expect((await auth.signOut()).isOk()).toBe(true)

    stop()

    expect((await auth.signIn(ann)).isOk()).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatch(/\S/)
    expect(seen[1]).toBeUndefined()
  })

  it('fails as a query, never as a refusal, when its session cannot be opened', async () => {
    local.db.newSession = () => Promise.reject(new Error('the database cannot be reached'))

    const codes = [
      (await auth.signUp(ann))._unsafeUnwrapErr().code,
      (await another().signIn(ann))._unsafeUnwrapErr().code,
      (
        await another().resume({ access: 'eyJ.e30.x', refresh: 'surreal-refresh-a-b' })
      )._unsafeUnwrapErr().code,
      (await another().current())._unsafeUnwrapErr().code,
    ]

    expect(codes).toEqual(Array.from({ length: 4 }, () => 'data:QUERY_FAILED'))
  })

  it('fails as a query, never as a refusal, when the database goes away under its session', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const saved = auth.tokens() ?? expect.unreachable('tokens after sign-up')

    await local.close()

    expect((await auth.current())._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect((await auth.resume(saved))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect((await auth.signIn(ann))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
  })

  it('tells a refusal by the database from a failure to ask it', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const saved = auth.tokens() ?? expect.unreachable('tokens after sign-up')
    const renewed = another()

    expect((await renewed.resume(saved)).isOk()).toBe(true)
    // The database judged each of these and refused it.
    expect((await another().resume(saved))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect((await another().resume({ access: 'not-a-token' }))._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
    expect(
      (
        await another().resume({ access: 'x', refresh: 'surreal-refresh-unknown' })
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
    expect(
      (await another().signIn({ ...ann, password: 'wrong-password' }))._unsafeUnwrapErr().code,
    ).toBe('data:INVALID_CREDENTIALS')
    expect((await another().signUp(ann))._unsafeUnwrapErr().code).toBe('data:SIGN_UP_REJECTED')
  })

  it('closes its session: later calls fail without a refusal and the main session keeps working', async () => {
    const opened: Array<{ readonly isValid: boolean }> = []
    const newSession = local.db.newSession.bind(local.db)

    local.db.newSession = async () => {
      const session = await newSession()

      opened.push(session)

      return session
    }

    expect((await auth.signUp(ann)).isOk()).toBe(true)

    await auth.close()

    expect(opened.map((session) => session.isValid)).toEqual([false])
    expect((await auth.current())._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect((await auth.signIn(ann))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect(opened).toHaveLength(1)
    expect((await runCommand(local, createIdentity, { email: 'b@example.test' })).isOk()).toBe(true)
  })

  it('closes without having opened a session, and stays closed', async () => {
    await auth.close()

    expect((await auth.signUp(ann))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
  })

  it('keeps its sessions when the directory schema is applied again with its signing key', async () => {
    await local.close()
    local = (await openTestDb({ signingKey: TEST_SIGNING_KEY }))._unsafeUnwrap()

    const signedUp = another()
    const user = (await signedUp.signUp(ann))._unsafeUnwrap()
    const access = signedUp.tokens()?.access ?? ''

    expect((await applySchema(local, readSchema('directory'), TEST_SIGNING_KEY)).isOk()).toBe(true)
    expect((await another().resume({ access }))._unsafeUnwrap()).toEqual(user)
  })
})
