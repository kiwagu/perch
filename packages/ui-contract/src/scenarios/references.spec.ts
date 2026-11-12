import { describe, expect, it } from 'vitest'

import { referencesIn } from './references'

describe('referencesIn', () => {
  it('reads the seven kinds of reference', () => {
    const text =
      'Open [/sign-in] and click [user.sign-in.submit-button] then see [code:welcome] in [state:ready] with [value:en] after [mail:sign-up] and [notice:reset-password.password-changed]'

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
        { kind: 'mail', value: 'sign-up', raw: '[mail:sign-up]' },
        {
          kind: 'notice',
          value: 'reset-password.password-changed',
          raw: '[notice:reset-password.password-changed]',
        },
      ],
      problems: [],
    })
  })
  it('reports a bracket group that is none of them', () => {
    expect(referencesIn('Click [Create]')).toEqual({
      references: [],
      problems: ['not an anchor, a route, a code, a state, a value, a mail or a notice: "Create"'],
    })
  })
  it('finds nothing in text without brackets', () => {
    expect(referencesIn('Reloading the page keeps the user signed in')).toEqual({
      references: [],
      problems: [],
    })
  })
})
