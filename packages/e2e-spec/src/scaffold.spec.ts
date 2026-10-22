import { describe, expect, it } from 'vitest'

import type { Scenario } from '@workspace/ui-contract'

import { scaffoldTest, testPathFor } from './scaffold'

const signUp: Scenario = {
  id: 'user/base/sign-up',
  title: 'Sign up and see the profile',
  tags: ['smoke'],
  devices: { A: 'guest' },
  where: '[/sign-in] then [user.sign-in.toggle-button]',
  data: { Email: 'generate', Password: 'generate', Name: 'generate', Locale: 'es' },
  scenario: 'A new user signs up and lands on the profile page',
  steps: [
    'Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]',
    'Click [user.sign-in.toggle-button]',
    "Enter the user's email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]",
    'Click [user.sign-in.submit-button]',
  ],
  expected: [
    'After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and [user.profile.heading] shows the entered name',
    '[user.profile.email-input] shows the entered email',
    'Reloading the page keeps the user signed in and shows the same name',
  ],
}

const output = scaffoldTest(signUp, { scenarioId: signUp.id })

describe('scaffoldTest', () => {
  it('names its scenario and has one step per scenario step', () => {
    expect(output.split('\n')[0]).toBe('// scenario: user/base/sign-up')
    expect(output.match(/test\.step\(/g)).toHaveLength(4)
    expect(output).toContain("test.step('1. Open [/sign-in] and wait for [app-shell.status]")
    expect(output).toContain("test.step('3. Enter the user\\'s email")
  })

  it('fails until every expected result is asserted', () => {
    expect(output.match(/expect\.soft\(false, 'TODO: /g)).toHaveLength(3)
  })

  it('generates the declared test data and keeps fixed values', () => {
    expect(output).toContain('email: generate.email()')
    expect(output).toContain("locale: 'es'")
  })

  it('starts a guest alone and a signed-in account for any other device', () => {
    expect(output).toContain('async ({ page }) =>')
    expect(
      scaffoldTest({ ...signUp, devices: { A: 'identity' } }, { scenarioId: signUp.id }),
    ).toContain('async ({ page, signedIn }) =>')
    expect(
      scaffoldTest({ ...signUp, devices: { A: 'guest', B: 'guest' } }, { scenarioId: signUp.id }),
    ).toContain('async ({ page, signedIn }) =>')
  })

  it('writes the skeleton of the sample', () => {
    expect(output).toMatchInlineSnapshot(`
      "// scenario: user/base/sign-up
      import { generate } from '../../support/data'
      import { expect, test } from '../../support/fixtures'

      test.describe('Sign up and see the profile', () => {
        test('A new user signs up and lands on the profile page', async ({ page }) => {
          const data = {
            email: generate.email(),
            password: generate.password(),
            name: generate.name(),
            locale: 'es',
          }

          await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
            // TODO: Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
          })

          await test.step('2. Click [user.sign-in.toggle-button]', async () => {
            // TODO: Click [user.sign-in.toggle-button]
          })

          await test.step('3. Enter the user\\'s email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]', async () => {
            // TODO: Enter the user's email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]
          })

          await test.step('4. Click [user.sign-in.submit-button]', async () => {
            // TODO: Click [user.sign-in.submit-button]
          })

          // Expected:
          // - After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and [user.profile.heading] shows the entered name
          expect.soft(false, 'TODO: After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me] and [user.profile.heading] shows the entered name').toBe(true)
          // - [user.profile.email-input] shows the entered email
          expect.soft(false, 'TODO: [user.profile.email-input] shows the entered email').toBe(true)
          // - Reloading the page keeps the user signed in and shows the same name
          expect.soft(false, 'TODO: Reloading the page keeps the user signed in and shows the same name').toBe(true)
        })
      })
      "
    `)
  })

  it('imports the support files from the depth of its id', () => {
    expect(scaffoldTest(signUp, { scenarioId: 'user/base/crud/sign-up' })).toContain(
      "import { expect, test } from '../../../support/fixtures'",
    )
  })
})

describe('testPathFor', () => {
  it('pairs a scenario with its test by id', () => {
    expect(testPathFor('tests/e2e/src', 'user/base/sign-up')).toBe(
      'tests/e2e/src/user/base/sign-up.e2e.spec.ts',
    )
  })
})
