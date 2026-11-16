import { describe, expect, it } from 'vitest'

import { REFERENCE_RULES } from './index'

/** Each meaning of a password pair's guards: its rule, the guard derived, its shape and what it holds. */
const MEANINGS = [
  {
    id: 'pair-differs',
    name: 'passwordsDiffer',
    shape: '`{ confirms: differs }`',
    meaning: 'the confirmation is not the same as the confirmed input',
  },
  {
    id: 'pair-strays',
    name: 'confirmationStrays',
    shape: '`{ confirms: strays }`',
    meaning:
      'the confirmation is no longer how the confirmed input begins: a character differs, or it is longer',
  },
  {
    id: 'pair-follows',
    name: 'confirmationFollows',
    shape: '`{ confirms: follows }`',
    meaning: 'the confirmation is how the confirmed input begins, all of it or a part, or is empty',
  },
  {
    id: 'composite-breaks',
    name: 'passwordBreaksRules',
    shape: '`{ composite: breaks }`',
    meaning:
      "the confirmed input breaks one of the rules of its composite's list. The composite's `items` are the judge: the input breaks the rules while one of them is not met",
  },
]

const ruleOf = (id: string) => REFERENCE_RULES.find((rule) => rule.id === id)

describe('the rules of a password pair', () => {
  it.each(MEANINGS)(
    'registers $id, saying what $name holds and the shape it is derived as',
    ({ id, name, shape, meaning }) => {
      const rule = ruleOf(id)

      expect(rule?.text).toContain(meaning)
      expect(rule?.text).toContain(`\`${name}\``)
      expect(rule?.text).toContain(shape)
    },
  )

  it('keeps the overview, which names each meaning by its rule and states none of them itself', () => {
    const overview = ruleOf('password-pair')?.text ?? ''

    for (const { id, meaning } of MEANINGS) {
      expect(overview).toContain(`the rule \`${id}\``)
      expect(overview).not.toContain(meaning)
    }
  })

  it('writes the overview before the four meanings, in the order of the guards', () => {
    const ids = REFERENCE_RULES.map((rule) => rule.id)
    const at = ids.indexOf('password-pair')

    expect(at).toBeGreaterThanOrEqual(0)
    expect(ids.slice(at, at + 5)).toEqual([
      'password-pair',
      'composite-breaks',
      'pair-differs',
      'pair-strays',
      'pair-follows',
    ])
  })
})
