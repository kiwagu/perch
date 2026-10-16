import { describe, expect, it } from 'vitest'

import type { SpecDoc } from './parse'
import { scaffoldTest, testPathFor } from './scaffold'

const spec: SpecDoc = {
  title: 'Sign up and see the profile',
  role: 'guest',
  where: '"/sign-in" → "Create account"',
  testData: [
    { name: 'Email', value: 'generate', generate: true },
    { name: 'New name', value: 'generate', generate: true },
    { name: 'Locale', value: 'es', generate: false },
  ],
  scenario: 'A new user signs up',
  steps: ['Open "/sign-in" and wait for the app to be ready', "Click the user's name"],
  expected: ['The URL is "/me"', 'The heading shows the name', 'Reloading keeps it'],
}

const output = scaffoldTest(spec, { specRelPath: 'tests/e2e/specs/user/01-sign-up.md' })

describe('scaffoldTest', () => {
  it('names its spec and describes the scenario with one step per spec step', () => {
    expect(output).toContain('// spec: tests/e2e/specs/user/01-sign-up.md')
    expect(output).toContain("test.describe('Sign up and see the profile'")
    expect(output).toContain("test('A new user signs up'")
    expect(output).toContain(`test.step('1. Open "/sign-in" and wait for the app to be ready'`)
    expect(output).toContain(`test.step('2. Click the user\\'s name'`)
  })

  it('fails until every expected result is asserted', () => {
    expect(output).toContain('// Expected:')
    expect(output.match(/expect\.soft\(false, 'TODO: /g)).toHaveLength(3)
  })

  it('generates the declared test data and keeps fixed values', () => {
    expect(output).toContain('email: generate.email()')
    expect(output).toContain('newName: generate.newName()')
    expect(output).toContain("locale: 'es'")
  })

  it('starts a signed-in user for the user role', () => {
    expect(output).toContain('async ({ page }) =>')
    expect(scaffoldTest({ ...spec, role: 'user' }, { specRelPath: 'x.md' })).toContain(
      'async ({ page, signedIn }) =>',
    )
  })
})

describe('testPathFor', () => {
  it('pairs a spec with its test by name', () => {
    expect(testPathFor('tests/e2e/specs/user/01-sign-up.md')._unsafeUnwrap()).toBe(
      'tests/e2e/src/user/01-sign-up.e2e.spec.ts',
    )
    expect(testPathFor('tests/e2e/user/01-sign-up.md').isErr()).toBe(true)
  })
})
