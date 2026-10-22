import { describe, expect, it } from 'vitest'

import { referencesIn } from './references'

describe('referencesIn', () => {
  it('reads the five kinds of reference', () => {
    const text =
      'Open [/sign-in] and click [user.sign-in.submit-button] then see [code:welcome] in [state:ready] with [value:en]'

    expect(referencesIn(text)).toEqual({
      references: [
        { kind: 'route', value: '/sign-in', raw: '[/sign-in]' },
        {
          kind: 'anchor',
          value: 'user.sign-in.submit-button',
          raw: '[user.sign-in.submit-button]',
        },
        { kind: 'code', value: 'welcome', raw: '[code:welcome]' },
        { kind: 'state', value: 'ready', raw: '[state:ready]' },
        { kind: 'value', value: 'en', raw: '[value:en]' },
      ],
      problems: [],
    })
  })
  it('reports a bracket group that is none of them', () => {
    expect(referencesIn('Click [Create]')).toEqual({
      references: [],
      problems: ['not an anchor, a route, a code, a state or a value: "Create"'],
    })
  })
  it('finds nothing in text without brackets', () => {
    expect(referencesIn('Reloading the page keeps the user signed in')).toEqual({
      references: [],
      problems: [],
    })
  })
})
