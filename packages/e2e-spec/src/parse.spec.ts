import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseSpec } from './parse'

const signUp = readFileSync(
  new URL('../../../tests/e2e/specs/user/01-sign-up.md', import.meta.url),
  'utf8',
)

describe('parseSpec', () => {
  it('reads every section of an instruction spec', () => {
    expect(parseSpec(signUp)._unsafeUnwrap()).toEqual({
      title: 'Sign up and see the profile',
      role: 'guest',
      where: '"/sign-in" → "Create account"',
      testData: [
        { name: 'Email', value: 'generate', generate: true },
        { name: 'Password', value: 'generate', generate: true },
        { name: 'Name', value: 'generate', generate: true },
      ],
      scenario: 'A new user signs up and lands on the profile page',
      steps: [
        'Open "/sign-in" and wait for the app to be ready',
        'Click "Create account"',
        'Enter email, password and name',
        'Click "Sign up"',
      ],
      expected: [
        'After step 4 the page shows the notification "Welcome", the URL is "/me", the heading shows the entered name',
        'The profile email field shows the entered email',
        'Reloading the page keeps the user signed in and shows the same name',
      ],
    })
  })

  it('takes the sections in any order and keeps a fixed test value', () => {
    const reordered = [
      '# Title',
      '',
      '### Steps',
      '1. Open "/me"',
      '',
      '## Scenario: Something happens',
      '',
      '### Expected result',
      '- It happened',
      '',
      '## Test data',
      '- Email: "ann@example.test"',
      '',
      'Where: "/me" → "Save"',
      'Role: user',
    ].join('\n')

    expect(parseSpec(reordered)._unsafeUnwrap()).toMatchObject({
      role: 'user',
      testData: [{ name: 'Email', value: 'ann@example.test', generate: false }],
      steps: ['Open "/me"'],
    })
  })

  it('refuses an unknown heading and a missing section', () => {
    expect(parseSpec(`${signUp}\n## Notes\n- free text\n`)._unsafeUnwrapErr()).toContain(
      'unknown heading "## Notes"',
    )
    expect(parseSpec(signUp.replace(/### Steps[\s\S]*?(?=###)/, ''))._unsafeUnwrapErr()).toContain(
      'missing section "### Steps"',
    )
  })
})
