import { DateTime, RecordId } from 'surrealdb'
import { describe, expect, it } from 'vitest'

import { fromDriverValue, recordId, recordRef, recordTableOf, toDriverParams } from './values'

describe('recordTableOf', () => {
  it('reads the table of a record type, also inside option', () => {
    expect(recordTableOf('record<identity>')).toBe('identity')
    expect(recordTableOf('option<record<profile>>')).toBe('profile')
    expect(recordTableOf('string')).toBeUndefined()
  })
})

describe('toDriverParams', () => {
  it('turns entity id strings of record parameters into record ids', () => {
    const params = toDriverParams({ identity: 'idn_1', name: 'Ann' }, [
      { name: 'identity', type: 'record<identity>' },
      { name: 'name', type: 'string' },
    ])

    expect(params['identity']).toBeInstanceOf(RecordId)
    expect(String(params['identity'])).toBe('identity:idn_1')
    expect(params['name']).toBe('Ann')
  })

  it('leaves an absent optional record parameter absent', () => {
    expect(toDriverParams({}, [{ name: 'identity', type: 'option<record<identity>>' }])).toEqual({})
  })
})

describe('fromDriverValue', () => {
  it('replaces record ids by their keys and datetimes by dates, deeply', () => {
    const at = new Date('2026-01-01T00:00:00Z')
    const value = fromDriverValue([
      {
        id: new RecordId('profile', 'prf_1'),
        at: new DateTime(at),
        tags: [new RecordId('identity', 'idn_1')],
      },
    ])

    expect(value).toEqual([{ id: 'prf_1', at, tags: ['idn_1'] }])
  })
})

describe('record helpers', () => {
  it('builds and splits record ids', () => {
    const id = recordId('identity', 'idn_1')

    expect(recordRef(id)).toEqual({ table: 'identity', key: 'idn_1' })
    expect(recordRef('identity:idn_1')).toBeUndefined()
  })
})
