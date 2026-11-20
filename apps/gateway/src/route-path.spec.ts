import { describe, expect, it } from 'vitest'

import { matchPath } from './route-path'

describe('matchPath', () => {
  it('matches a template with no parameter by the whole path alone', () => {
    expect(matchPath('/devices', '/devices')).toEqual({})
    expect(matchPath('/devices', '/devices/')).toBeUndefined()
    expect(matchPath('/devices', '/Devices')).toBeUndefined()
    expect(matchPath('/devices', '/devices/x')).toBeUndefined()
    expect(matchPath('/devices', '/')).toBeUndefined()
  })

  it('reads each `:name` segment as the parameter of that name', () => {
    expect(
      matchPath('/organisations/:key/members/:identity', '/organisations/acme/members/idn_1'),
    ).toEqual({ key: 'acme', identity: 'idn_1' })
  })

  it('takes a segment whole, never empty and never with a slash in it', () => {
    expect(matchPath('/devices/:id', '/devices/')).toBeUndefined()
    expect(matchPath('/devices/:id', '/devices//')).toBeUndefined()
    expect(matchPath('/devices/:id', '/devices/a/b')).toBeUndefined()
    expect(matchPath('/devices/:id', '/devices')).toBeUndefined()
    expect(matchPath('/devices/:id', '/devices/a%2Fb')).toEqual({ id: 'a%2Fb' })
  })

  it('keeps every literal segment as the template writes it', () => {
    expect(matchPath('/a/:x/b', '/a/1/c')).toBeUndefined()
    expect(matchPath('/a/:x/b', '/z/1/b')).toBeUndefined()
    expect(matchPath('/a/:x/b', '/a/1/b')).toEqual({ x: '1' })
  })

  it('holds a parameter to its rule where the template is given one', () => {
    const key = { key: /^[a-z][a-z0-9_]{1,31}$/ }

    expect(matchPath('/o/:key/m', '/o/acme/m', key)).toEqual({ key: 'acme' })
    expect(matchPath('/o/:key/m', '/o/Acme/m', key)).toBeUndefined()
    expect(matchPath('/o/:key/m', '/o/a/m', key)).toBeUndefined()
    expect(matchPath('/o/:key/m/:id', '/o/acme/m/A', key)).toEqual({ key: 'acme', id: 'A' })
  })
})
