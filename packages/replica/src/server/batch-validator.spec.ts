import { LoroMap, type LoroText } from 'loro-crdt'
import { describe, expect, it } from 'vitest'

import { documentWithProfile, exportSince, forkOf, input } from './__fixtures__/batch'
import { validateBatch } from './batch-validator'

describe('batch validation', () => {
  it('turns an accepted edit into one projected row with column values', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    const result = validateBatch(input(server, [exportSince(client, server)]))

    const { plan } = result._unsafeUnwrap()

    expect(plan.upserts).toMatchObject([{ table: 'profile', key: 'prf_1', data: { name: 'Ana' } }])
    expect(plan.upserts[0]?.data['created_at']).toBeInstanceOf(Date)
    expect(plan.deletes).toEqual([])
  })

  it('projects a record whose text field changed', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)
    const bio = client.recordMap('profile/prf_1').get('bio') as LoroText

    bio.insert(5, ', world')

    const { plan } = validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrap()

    expect(plan.upserts).toMatchObject([{ key: 'prf_1', data: { bio: 'Hello, world' } }])
  })

  it('plans the bytes that bring the authoritative document to the version of the fork', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    const { fork, plan } = validateBatch(
      input(server, [exportSince(client, server)]),
    )._unsafeUnwrap()
    const replay = forkOf(server)

    replay.import(plan.bytes)

    expect(replay.version().encode()).toEqual(plan.version)
    expect(plan.version).toEqual(fork.version().encode())
    expect(replay.recordMap('profile/prf_1').get('name')).toBe('Ana')
  })

  it('plans a deletion for a removed record', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().delete('profile/prf_1')

    const { plan } = validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrap()

    expect(plan.deletes).toEqual([{ table: 'profile', key: 'prf_1', entry: 'profile/prf_1' }])
  })

  it('refuses a record of a table outside the region', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('foreign-table')
  })

  it('refuses a private record that points at another identity', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('identity', 'identity:idn_other')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('foreign-owner')
  })

  it('refuses a record that is a plain value instead of a map', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().set('profile/prf_2', 'Ana')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('invalid-record')
  })

  it('refuses a batch that writes a root container other than the records', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.getMap('other').set('x', 1)

    expect(validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr()).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: other',
    })
  })

  it('refuses the whole batch when it edits a record and writes outside the records', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')
    client.getMap('other').set('x', 1)

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('malformed')
    expect(server.version().encode()).toEqual(before)
    expect(server.recordMap('profile/prf_1').get('name')).toBe('Ann')
  })

  it('refuses bytes that are not a Loro update', () => {
    expect(
      validateBatch(
        input(documentWithProfile('Ann'), [new Uint8Array([1, 2, 3])]),
      )._unsafeUnwrapErr().reason,
    ).toBe('malformed')
  })

  it('refuses an update that depends on history the server lacks', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')
    client.commit()

    const middle = client.version()

    client.recordMap('profile/prf_1').set('name', 'Anna')

    const update = client.export({ mode: 'update', from: middle })

    expect(validateBatch(input(server, [update]))._unsafeUnwrapErr().reason).toBe(
      'pending-dependencies',
    )
  })

  it('accepts a batch whose net effect is empty: an edit followed by its inverse', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    client.commit()
    client.records().delete('note/n_1')

    expect(validateBatch(input(server, [exportSince(client, server)])).isOk()).toBe(true)
  })

  it('leaves the authoritative document untouched', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    expect(validateBatch(input(server, [exportSince(client, server)])).isOk()).toBe(true)
    expect(server.version().encode()).toEqual(before)
    expect(server.recordMap('profile/prf_1').get('name')).toBe('Ann')
  })
})
