import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '../types'

import { interceptQueries, openTestDb } from './index'

let local: LocalDb

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

describe('interceptQueries', () => {
  it('runs the hook before each query and passes the query on', async () => {
    const seen: string[] = []
    const watched = interceptQueries(local, (text) => {
      seen.push(text)
    })

    expect(await watched.db.query('RETURN 1 + 1;')).toEqual([2])
    expect(seen).toEqual(['RETURN 1 + 1;'])
  })

  it('fails the query when the hook throws, and holds it while the hook waits', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const broken = interceptQueries(local, async (text) => {
      if (text.includes('FAIL')) {
        throw new Error('refused')
      }

      await gate
    })

    await expect(broken.db.query('RETURN "FAIL";')).rejects.toThrow('refused')

    let answered = false
    const held = Promise.resolve(broken.db.query('RETURN 1;')).then((result) => {
      answered = true

      return result
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(answered).toBe(false)
    release()
    expect(await held).toEqual([1])
  })

  it('leaves every other method of the database working', async () => {
    const watched = interceptQueries(local, () => {})
    const session = await watched.db.newSession()

    await session.use({ namespace: 'app', database: 'app' })

    expect(await session.query('RETURN 3;')).toEqual([3])
  })
})
