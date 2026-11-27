import { describe, expect, it } from 'vitest'

import { ORGANISATION_PATHS, targetOf } from './targets'

/** A path of the table with each parameter given a text that keeps its rule. */
const filled = (template: string): string => template.replace(':key', 'acme').replace(/:\w+/g, 'x')

describe('targetOf', () => {
  it('names a target for each path the routes list, each of the five kinds once', () => {
    expect(ORGANISATION_PATHS.map((template) => targetOf(filled(template))?.kind)).toEqual([
      'organisations',
      'members',
      'member',
      'invitations',
      'invitation',
    ])
  })

  it('reads the key, the identity and the invitation from the segments of the path', () => {
    expect(targetOf('/organisations/acme/members/idn_1')).toEqual({
      kind: 'member',
      key: 'acme',
      identity: 'idn_1',
    })
    expect(targetOf('/organisations/acme/invitations/inv_1')).toEqual({
      kind: 'invitation',
      key: 'acme',
      invitation: 'inv_1',
    })
  })

  it('names no target for a path the routes do not list', () => {
    for (const path of [
      '/organisations/',
      '/organisations/acme',
      '/organisations/acme/',
      '/organisations/Acme/members',
      '/organisations/a/members',
      '/organisations/acme/members/',
      '/organisations/acme/members/x/y',
      '/organisations/acme/invitations/',
      '/organisations/acme/notes',
      '/organisation',
      '/organisations/acme/members/x/',
    ]) {
      expect(targetOf(path), path).toBeUndefined()
    }
  })
})
