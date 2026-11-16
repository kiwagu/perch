import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE } from '../files'
import { platformSchema } from '../schemas'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { valueProblems } from './values'

/** The sample with a platform value `flag`, and sign-out's parameter written as `parameter`. */
function withParameter(parameter: Record<string, unknown>): Contract {
  const contract = sampleContract()
  const signOut = contract.screens.platform.actions['sign-out']

  if (signOut === undefined) {
    throw new Error('the sample has no sign-out')
  }

  contract.screens.platform.values = {
    flag: { type: 'boolean', description: 'Whether something holds.' },
  }
  signOut.params = {
    forgetUnsent: { description: 'Drop the unsent changes.', ...parameter },
  }

  return contract
}

const AT = 'actions["sign-out"].params.forgetUnsent.value'

/** The sample with a string value `name` and a closed value `size`, and sign-out's parameter. */
function narrowing(parameter: Record<string, unknown>): Contract {
  const contract = withParameter(parameter)

  contract.screens.platform.values = {
    name: { type: 'string', minLength: 1, maxLength: 80, pattern: '^\\S', description: 'A name.' },
    size: { type: 'string', enum: ['small', 'large'], format: 'email', description: 'A size.' },
  }

  return contract
}

const PARAM = 'actions["sign-out"].params.forgetUnsent'

describe('valueProblems', () => {
  it('passes a parameter that refers to a platform value or to a field of the model', () => {
    expect(valueProblems(withParameter({ value: 'flag' }))).toEqual([])
    expect(valueProblems(withParameter({ value: 'thing.title' }))).toEqual([])
    expect(valueProblems(withParameter({ type: 'boolean' }))).toEqual([])
  })
  it('refuses a value the platform does not declare, at the parameter', () => {
    expect(valueProblems(withParameter({ value: 'flags' }))).toEqual([
      { file: PLATFORM_FILE, message: `${AT}: "flags" is no value of platform.values` },
    ])
  })
  it('refuses a platform value while the platform declares none', () => {
    const contract = withParameter({ value: 'flag' })

    contract.screens.platform.values = undefined

    expect(valueProblems(contract)).toEqual([
      { file: PLATFORM_FILE, message: `${AT}: "flag" is no value of platform.values` },
    ])
  })
  it('refuses a field the model does not have, at the parameter', () => {
    expect(valueProblems(withParameter({ value: 'thing.colour' }))).toEqual([
      {
        file: PLATFORM_FILE,
        message: `${AT}: "thing.colour": entity "thing" has no field "colour"`,
      },
    ])
    expect(valueProblems(withParameter({ value: 'team.name' }))).toEqual([
      { file: PLATFORM_FILE, message: `${AT}: "team.name": no entity "team" in the model` },
    ])
  })
})

describe('valueProblems and the keywords written beside a value', () => {
  it('passes keywords that narrow the value: a tighter bound, a subset of its enum, the same type', () => {
    expect(
      valueProblems(narrowing({ value: 'name', type: 'string', minLength: 2, maxLength: 40 })),
    ).toEqual([])
    expect(valueProblems(narrowing({ value: 'size', enum: ['small'], format: 'email' }))).toEqual(
      [],
    )
    expect(valueProblems(narrowing({ value: 'size', minLength: 1, pattern: '^[a-z]+$' }))).toEqual(
      [],
    )
  })
  it('refuses each keyword that would widen the value, at the keyword, naming the value', () => {
    expect(
      valueProblems(narrowing({ value: 'name', maxLength: 500, minLength: 0 })).map(
        ({ message }) => message,
      ),
    ).toEqual([
      `${PARAM}.minLength: 0 does not narrow the value "name", whose minLength is 1: a keyword written beside \`value\` may only narrow it`,
      `${PARAM}.maxLength: 500 does not narrow the value "name", whose maxLength is 80: a keyword written beside \`value\` may only narrow it`,
    ])
  })
  it('refuses another type, an enum member the value lacks and another pattern', () => {
    expect(
      valueProblems(narrowing({ value: 'name', type: 'number', pattern: '^[a-z]+$' })).map(
        ({ message }) => message,
      ),
    ).toEqual([
      `${PARAM}.type: "number" does not narrow the value "name", whose type is "string": a keyword written beside \`value\` may only narrow it`,
      `${PARAM}.pattern: "^[a-z]+$" does not narrow the value "name", whose pattern is "^\\\\S": a keyword written beside \`value\` may only narrow it`,
    ])
    expect(
      valueProblems(narrowing({ value: 'size', enum: ['small', 'huge'] })).map(
        ({ message }) => message,
      ),
    ).toEqual([
      `${PARAM}.enum: ["small","huge"] does not narrow the value "size", whose enum is ["small","large"]: a keyword written beside \`value\` may only narrow it`,
    ])
  })
  it('refuses a pattern beside a value that has one, the same one included', () => {
    expect(
      valueProblems(narrowing({ value: 'name', pattern: '^\\S' })).map(({ message }) => message),
    ).toEqual([
      `${PARAM}.pattern: "^\\\\S" does not narrow the value "name", whose pattern is "^\\\\S": a keyword written beside \`value\` may only narrow it`,
    ])
  })
})

const PLATFORM = {
  actions: {},
  reserved: ['app-shell.status'],
  status: { anchor: 'app-shell.status', states: ['ready'] },
}

const withAction = (parameter: Record<string, unknown>) => ({
  ...PLATFORM,
  actions: {
    'sign-in': {
      description: 'Signs this device in.',
      params: { email: { description: 'The email of the account.', ...parameter } },
      result: 'this device is signed in',
      codes: ['failed'],
      changes: [],
    },
  },
})

const EMAIL = { type: 'string', format: 'email', maxLength: 254, description: 'An address.' }

describe('platformSchema values and parameters', () => {
  it('accepts values by name, and a parameter that refers to one, narrows it or writes a type', () => {
    for (const parameter of [
      { value: 'email' },
      { value: 'email', maxLength: 100 },
      { value: 'profile.name', optional: true },
      { type: 'string', minLength: 1, pattern: '^[a-z]+$' },
      { type: 'number', minimum: 1, maximum: 10, enum: [1, 10] },
      { value: 'email', codes: ['email-rejected'] },
    ]) {
      const platform = { ...withAction(parameter), values: { email: EMAIL } }

      expect(platformSchema.safeParse(platform).error?.issues, JSON.stringify(parameter)).toBe(
        undefined,
      )
    }
  })
  it('refuses a parameter that writes neither its type nor its value', () => {
    expect(platformSchema.safeParse(withAction({})).success).toBe(false)
    expect(platformSchema.safeParse(withAction({ maxLength: 10 })).success).toBe(false)
  })
  it('refuses a malformed ref, another format, an empty list of codes and an unknown key', () => {
    for (const parameter of [
      { value: 'Email' },
      { value: 'profile.name.first' },
      { value: 'email', format: 'uri' },
      { value: 'email', codes: [] },
      { value: 'email', optional: false },
      { value: 'email', default: 'a' },
    ]) {
      expect(
        platformSchema.safeParse(withAction(parameter)).success,
        JSON.stringify(parameter),
      ).toBe(false)
    }
  })
  it('refuses a value without its description, with a key of its own, or named in another case', () => {
    for (const values of [
      { email: { type: 'string' } },
      { email: { ...EMAIL, optional: true } },
      { email: { ...EMAIL, format: 'uri' } },
      { Email: EMAIL },
    ]) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, values }).success,
        JSON.stringify(values),
      ).toBe(false)
    }
  })
  it('takes enum members that are strings or numbers, never booleans, in a value and a parameter', () => {
    expect(
      platformSchema.safeParse({
        ...PLATFORM,
        values: { kind: { enum: ['a', 1], description: 'A kind.' } },
      }).error?.issues,
    ).toBeUndefined()
    expect(
      platformSchema.safeParse({
        ...PLATFORM,
        values: { flag: { type: 'boolean', enum: [true, false], description: 'A flag.' } },
      }).success,
    ).toBe(false)
    expect(platformSchema.safeParse(withAction({ type: 'boolean', enum: [true] })).success).toBe(
      false,
    )
  })
  it('takes any list of examples in a value: empty, of objects, of null', () => {
    for (const examples of [[], [{ at: 'a' }], [null], ['a', 1, true]]) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, values: { email: { ...EMAIL, examples } } }).error
          ?.issues,
        JSON.stringify(examples),
      ).toBeUndefined()
    }
  })
})
