// scenario: user/base/password-rules
import type { Locator } from '@playwright/test'

import { generate } from '../../support/data'
import { appReady, checkYourMail, expect, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'

/** The rules of the list, by the name of their item, in the order it shows them. */
const RULES = ['length', 'characters', 'digit', 'uppercase', 'lowercase', 'symbol'] as const

type Rule = (typeof RULES)[number]

test.describe('Sign up with a password that keeps the rules', { tag: '@smoke' }, () => {
  test('The rules of a new password are marked as it is typed, and the account is asked for only once the password keeps them all', async ({
    page,
  }) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
      lowercaseOnly: 'abcdefghij',
      everyRule: 'Abcdefghij1!',
      withASpace: 'Abcdefg hij1!',
      tooLong: 'Abcdefghij1!Abcdefghij1!Abcdefghij1!',
    }
    const list = page.getByTestId('user.sign-in.password-rule-list')
    const items: Readonly<Record<Rule, Locator>> = {
      length: page.getByTestId('user.sign-in.password-rule-list.length-item'),
      characters: page.getByTestId('user.sign-in.password-rule-list.characters-item'),
      digit: page.getByTestId('user.sign-in.password-rule-list.digit-item'),
      uppercase: page.getByTestId('user.sign-in.password-rule-list.uppercase-item'),
      lowercase: page.getByTestId('user.sign-in.password-rule-list.lowercase-item'),
      symbol: page.getByTestId('user.sign-in.password-rule-list.symbol-item'),
    }
    const password = page.getByTestId('user.sign-in.password-input')
    const submit = page.getByTestId('user.sign-in.submit-button')
    const toggle = page.getByTestId('user.sign-in.toggle-button')

    /** Each item carries `met` exactly when its rule is among `met`, and no state otherwise. */
    async function expectMet(...met: readonly Rule[]): Promise<void> {
      for (const rule of RULES) {
        if (met.includes(rule)) {
          await expect(items[rule]).toHaveAttribute('data-state', 'met')
        } else {
          await expect(items[rule]).not.toHaveAttribute('data-state')
        }
      }
    }

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      await expect(list).toHaveCount(0)
    })

    await test.step('2. Click [user.sign-in.toggle-button]', async () => {
      await expect(toggle).toHaveAttribute('data-value', 'sign-up')
      await toggle.click()
      // Expected: After step 2 [user.sign-in.password-rule-list] shows and none of its items
      //   carries [state:met]; [user.sign-in.submit-button] is disabled
      await expect(list).toBeVisible()
      await expectMet()
      await expect(submit).toBeDisabled()
    })

    await test.step('3. Enter the lowercase only into [user.sign-in.password-input]', async () => {
      await password.fill(data.lowercaseOnly)
      // Expected: After step 3 [user.sign-in.password-rule-list.length-item],
      //   [user.sign-in.password-rule-list.characters-item] and
      //   [user.sign-in.password-rule-list.lowercase-item] carry [state:met], the digit, uppercase
      //   and symbol items do not, and [user.sign-in.submit-button] is disabled
      await expectMet('length', 'characters', 'lowercase')
      await expect(submit).toBeDisabled()
    })

    await test.step('4. Enter the every rule into [user.sign-in.password-input]', async () => {
      await password.fill(data.everyRule)
      // Expected: After step 4 every item of [user.sign-in.password-rule-list] carries
      //   [state:met], and no [user.sign-in.error] shows
      await expectMet(...RULES)
      await expect(page.getByTestId('user.sign-in.error')).toHaveCount(0)
      // Nothing typed again yet follows the password, so the flow takes the submit.
      await expect(submit).toBeEnabled()
    })

    await test.step('5. Enter the with a space into [user.sign-in.password-input]', async () => {
      await password.fill(data.withASpace)
      // Expected: After step 5 [user.sign-in.password-rule-list.characters-item] no longer
      //   carries [state:met] and [user.sign-in.submit-button] is disabled
      await expect(items.characters).not.toHaveAttribute('data-state')
      await expect(submit).toBeDisabled()
    })

    await test.step('6. Enter the too long into [user.sign-in.password-input]', async () => {
      await password.fill(data.tooLong)
      // Expected: After step 6 [user.sign-in.password-rule-list.length-item] no longer carries
      //   [state:met], [user.sign-in.password-rule-list.characters-item] carries it again, and
      //   [user.sign-in.submit-button] is disabled
      await expect(items.length).not.toHaveAttribute('data-state')
      await expect(items.characters).toHaveAttribute('data-state', 'met')
      await expect(submit).toBeDisabled()
    })

    await test.step('7. Enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await password.fill(data.password)
      await page.getByTestId('user.sign-in.password-confirmation-input').fill(data.password)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
      await expectMet(...RULES)
      await submit.click()
      // Expected: After step 7 [user.sign-in.mail-message] carries [code:check-your-mail],
      //   [mail:sign-up] reaches the email, and no [user.sign-in.password-rule-list] shows
      await expect(checkYourMail(page)).toBeVisible()
      await expect(list).toHaveCount(0)
      expectDeclaredMail(await mailbox.next(data.email, 0), 'sign-up', {
        params: { email: data.email, locale: 'en' },
      })
    })
  })
})
