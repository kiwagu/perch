import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { dataError, type LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import uniqueKey from './__fixtures__/unique-key.surql'
import uniqueKeyAgain from './__fixtures__/unique-key-again.surql'
import { takenIn } from './organisation-rows'

let local: LocalDb | undefined

afterEach(async () => {
  await local?.close()
  local = undefined
})

describe('takenIn', () => {
  it("tells the database's refusal of a value a unique index already holds, by the index", async () => {
    local = (await openTestDb())._unsafeUnwrap()
    await local.db.query(uniqueKey)

    const refusal = (
      await ResultAsync.fromPromise(local.db.query(uniqueKeyAgain), (cause) =>
        dataError('data:WRITE_FAILED', 'could not write the probe', cause),
      )
    )._unsafeUnwrapErr()

    expect(takenIn('probe_key', refusal)).toBe(true)
    expect(takenIn('tenant_key', refusal)).toBe(false)
    expect(
      takenIn('probe_key', dataError('data:WRITE_FAILED', 'lost', new Error('connection lost'))),
    ).toBe(false)
  })
})
