import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE } from '../files'
import type { PlatformParameter } from '../schemas'

import { attributionProblems } from './attribution'
import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'

/**
 * The sample at `version`, with a platform value `name` and an action `things.rename` taking
 * `params` and failing with `codes`.
 */
function renaming(
  version: number,
  params: Readonly<Record<string, PlatformParameter>>,
  codes: readonly string[],
): Contract {
  const contract = sampleContract()

  contract.screens.version = version
  contract.screens.platform.values = {
    name: { type: 'string', minLength: 1, maxLength: 80, description: 'A name.' },
    flag: { type: 'boolean', description: 'Whether something holds.' },
  }
  contract.screens.platform.actions['things.rename'] = {
    description: 'Renames a thing.',
    params: { ...params },
    result: 'the thing has its new name',
    codes: [...codes],
    changes: [],
  }

  return contract
}

const NOTE: PlatformParameter = {
  type: 'string',
  maxLength: 500,
  codes: ['rename-rejected'],
  description: 'A note.',
}

/** Every parameter and code of `things.rename` as the version-3 rules want them. */
const ATTRIBUTED: Readonly<Record<string, PlatformParameter>> = {
  name: { value: 'name', description: 'The new name.' },
  currentPassword: { type: 'string', minLength: 1, description: 'The password as it is.' },
  note: NOTE,
  forget: { value: 'flag', description: 'Forget the old name.' },
}
const ATTRIBUTED_CODES = [
  'name-required',
  'name-too-long',
  'current-password-required',
  'current-password-rejected',
  'note-taken',
  'rename-rejected',
  'invalid-credentials',
  'failed',
]

const AT = 'actions["things.rename"]'
const problem = (message: string) => ({ file: PLATFORM_FILE, message })

describe('attributionProblems', () => {
  it('passes a contract whose platform codes each concern a parameter that bounds them', () => {
    expect(attributionProblems(renaming(3, ATTRIBUTED, ATTRIBUTED_CODES))).toEqual([])
  })

  it('passes the sample, whose platform takes no string and fails with no code of a field', () => {
    const contract = sampleContract()

    contract.screens.version = 3

    expect(attributionProblems(contract)).toEqual([])
  })

  it('wants a string parameter to refer to a value or write a constraint (rule 1)', () => {
    const contract = renaming(
      3,
      { ...ATTRIBUTED, comment: { type: 'string', description: 'A comment.' } },
      ATTRIBUTED_CODES,
    )

    expect(attributionProblems(contract)).toEqual([
      problem(
        `${AT}.params.comment: a string that refers to no value and writes no constraint: refer to a value (\`value: <name>\`) or write a constraint beside its type`,
      ),
    ])
  })

  it('wants a code that ends like the code of a field to concern a parameter (rule 2)', () => {
    const contract = renaming(3, ATTRIBUTED, [...ATTRIBUTED_CODES, 'title-invalid'])

    expect(attributionProblems(contract)).toEqual([
      problem(
        `${AT}.codes[8]: "title-invalid" ends like the code of a field ("-invalid") but concerns no parameter: name it after one (\`<parameter>-invalid\`) or list it in the \`codes\` of the one it concerns`,
      ),
    ])
  })

  it('wants a code named after a parameter to name a constraint its value has (rule 3)', () => {
    const contract = renaming(3, ATTRIBUTED, [
      ...ATTRIBUTED_CODES,
      'name-invalid',
      'note-too-short',
    ])

    expect(attributionProblems(contract)).toEqual([
      problem(
        `${AT}.codes[8]: "name-invalid" is named after the parameter "name", whose value has no pattern, format or enum`,
      ),
      problem(
        `${AT}.codes[9]: "note-too-short" is named after the parameter "note", whose value has no minLength above 1`,
      ),
    ])
  })

  it("wants a parameter's codes to be codes of its action (rule 4)", () => {
    const contract = renaming(
      3,
      { ...ATTRIBUTED, note: { ...NOTE, codes: ['rename-rejected', 'gone'] } },
      ATTRIBUTED_CODES,
    )

    expect(attributionProblems(contract)).toEqual([
      problem(`${AT}.params.note.codes[1]: "gone" is no code of the action "things.rename"`),
    ])
  })

  it('holds the codes of a map to the same rules, each problem at its code', () => {
    const contract = renaming(
      3,
      { ...ATTRIBUTED, note: { ...NOTE, codes: ['rename-rejected', 'gone'] } },
      [],
    )
    const action = contract.screens.platform.actions['things.rename']

    if (action === undefined) {
      throw new Error('the sample lost things.rename')
    }

    action.codes = Object.fromEntries(
      [...ATTRIBUTED_CODES, 'title-invalid', 'name-invalid'].map((code) => [code, `when ${code}`]),
    )

    expect(attributionProblems(contract)).toEqual([
      problem(
        `${AT}.codes["title-invalid"]: "title-invalid" ends like the code of a field ("-invalid") but concerns no parameter: name it after one (\`<parameter>-invalid\`) or list it in the \`codes\` of the one it concerns`,
      ),
      problem(
        `${AT}.codes["name-invalid"]: "name-invalid" is named after the parameter "name", whose value has no pattern, format or enum`,
      ),
      problem(`${AT}.params.note.codes[1]: "gone" is no code of the action "things.rename"`),
    ])
  })

  it('holds a contract before version 3 to none of the four rules', () => {
    const broken = renaming(
      2,
      {
        ...ATTRIBUTED,
        comment: { type: 'string', description: 'A comment.' },
        note: { ...NOTE, codes: ['rename-rejected', 'gone'] },
      },
      [...ATTRIBUTED_CODES, 'title-invalid', 'name-invalid'],
    )

    expect(
      attributionProblems({ ...broken, screens: { ...broken.screens, version: 3 } }),
    ).toHaveLength(4)
    expect(attributionProblems(broken)).toEqual([])
    expect(attributionProblems({ ...broken, screens: { ...broken.screens, version: 1 } })).toEqual(
      [],
    )
  })
})
