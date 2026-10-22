import { describe, expect, it } from 'vitest'

import type { Binding } from '../files'
import { bindingSchema } from '../schemas'

import { exampleOf } from './example'

const binding = (fields: Readonly<Record<string, unknown>>): Binding =>
  bindingSchema.parse({ roles: ['member'], ...fields })

const flat = (properties: Readonly<Record<string, unknown>>) => ({
  type: 'object',
  properties,
  additionalProperties: false,
})

const linkOf = (fields: Readonly<Record<string, unknown>>): string =>
  exampleOf(binding(fields)).link

describe('exampleOf', () => {
  it('fills each path parameter with its first example', () => {
    const key = { type: 'string', examples: ['thg_01hzx9k2', 'thg_01hzxa7q'] }

    expect(exampleOf(binding({ path: '/sample/$key', params: flat({ key }) }))).toEqual({
      params: { key: 'thg_01hzx9k2' },
      search: {},
      link: '/sample/thg_01hzx9k2',
    })
  })
  it('fills a path parameter without an example with its first enum value, else by its type', () => {
    const params = flat({
      tab: { type: 'string', enum: ['read', 'edit'] },
      name: { type: 'string' },
      page: { type: 'integer' },
      open: { type: 'boolean' },
    })

    expect(exampleOf(binding({ path: '/a/$tab/$name/$page/$open', params }))).toEqual({
      params: { tab: 'read', name: 'name', page: '1', open: 'true' },
      search: {},
      link: '/a/read/name/1/true',
    })
  })
  it('takes an optional segment only when its parameter has an example', () => {
    const path = '/notes/{-$tab}'

    expect(
      exampleOf(binding({ path, params: flat({ tab: { type: 'string', examples: ['a'] } }) })),
    ).toEqual({ params: { tab: 'a' }, search: {}, link: '/notes/a' })
    expect(exampleOf(binding({ path, params: flat({ tab: { type: 'string' } }) }))).toEqual({
      params: {},
      search: {},
      link: '/notes',
    })
  })
  it('leaves out a splat, which takes no example, with its segment', () => {
    expect(linkOf({ path: '/files/$' })).toBe('/files')
    expect(linkOf({ path: '/' })).toBe('/')
  })
  it('writes a path parameter as encodeURIComponent does', () => {
    const params = flat({ key: { type: 'string', examples: ['a b/c?d'] } })

    expect(linkOf({ path: '/x/$key', params })).toBe('/x/a%20b%2Fc%3Fd')
  })
  it('takes each search key in its order: its default, else its first enum value or example', () => {
    const search = flat({
      view: { type: 'string', enum: ['read', 'edit'], default: 'edit' },
      tab: { type: 'string', enum: ['a', 'b'], examples: ['b'] },
      q: { type: 'string', examples: ['hello', 'world'] },
      note: { type: 'string' },
      page: { type: 'integer', default: 1, examples: [3] },
    })

    expect(exampleOf(binding({ path: '/list', search }))).toEqual({
      params: {},
      search: { view: 'edit', tab: 'a', q: 'hello', page: 1 },
      link: '/list?view=edit&tab=a&q=hello&page=1',
    })
  })
  it("writes the search as the router's default stringifySearch does", () => {
    const search = flat({
      view: { type: 'string', default: 'read' },
      pageSize: { type: 'integer', default: 10 },
      ratio: { type: 'number', default: 1.5 },
      open: { type: 'boolean', default: true },
      code: { type: 'string', examples: ['123'] },
      flag: { type: 'string', examples: ['true'] },
      dash: { type: 'string', examples: ['-'] },
      q: { type: 'string', examples: ["two words!'()~*"] },
    })

    expect(linkOf({ path: '/list', search })).toBe(
      '/list?view=read&pageSize=10&ratio=1.5&open=true&code=%22123%22&flag=%22true%22&dash=-&q=two+words%21%27%28%29%7E*',
    )
  })
})
