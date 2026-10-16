import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import type { AuthPort } from './auth.port'
import { runCommand } from './commands'
import { openTestDb, readSchema } from './testing'
import type { Command, LocalDb } from './types'

const createUser: Command<{ email: string; name: string }> = {
  id: 'fixture.create-user',
  kind: 'command',
  text: readFileSync(new URL('./__fixtures__/create-user.surql', import.meta.url), 'utf8'),
  params: [
    { name: 'email', type: 'string' },
    { name: 'name', type: 'string' },
  ],
  tables: ['user'],
  region: 'server',
  ops: [],
}

const ann = { email: 'ann@example.test', password: 'secret-ann', name: 'Ann' }

let local: LocalDb
let auth: AuthPort

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  auth = createAuth(local, { access: 'user', namespace: 'app', database: 'app' })
})

afterEach(async () => {
  await local.close()
})

const another = () => createAuth(local, { access: 'user', namespace: 'app', database: 'app' })

describe('createAuth', () => {
  it('signs up and reports the account as the current user', async () => {
    const user = (await auth.signUp(ann))._unsafeUnwrap()
    const current = (await auth.current())._unsafeUnwrap()

    expect(user.id).toMatch(/^usr_/)
    expect(user).toEqual({ id: user.id, email: ann.email, name: ann.name })
    expect(current).toEqual(user)
    expect(auth.tokens()?.access).toMatch(/^ey/)
    expect(auth.tokens()?.refresh).toMatch(/\S/)
  })

  it('leaves the main session able to write after a sign-up', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const written = await runCommand(local, createUser, { email: 'b@example.test', name: 'B' })

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

  it('loses its sessions when the access method is defined again, which is why a reopened database skips an unchanged schema', async () => {
    expect((await auth.signUp(ann)).isOk()).toBe(true)

    const access = auth.tokens()?.access ?? ''

    await local.db.query(readSchema())

    expect((await another().resume({ access }))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })
})
