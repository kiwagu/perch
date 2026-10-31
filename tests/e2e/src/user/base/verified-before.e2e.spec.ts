// scenario: user/base/verified-before
import { firstLink } from '@workspace/mailbox'

import { generate } from '../../support/data'
import { expect, startSignUp, test } from '../../support/fixtures'
import { openDeclaredMail } from '../../support/mail-contract'

test.describe('Open a verification link a second time', { tag: '@smoke' }, () => {
  test('A link opened again says the email is verified and signs nothing in', async ({ page }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    const mail =
      await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and wait for [/me]', async () => {
        await startSignUp(page, data)

        const opened = await openDeclaredMail(page, 'sign-up', {
          params: { email: data.email, locale: 'en' },
        })

        await page.waitForURL('**/me')
        await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)

        return opened
      })

    await test.step('2. Click [user.profile.sign-out-button] and wait for [/sign-in]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    })

    await test.step('3. Open the link of the same [mail:sign-up] again', async () => {
      await page.goto(firstLink(mail))
      // Expected: After step 3 [user.verify-email.message] carries [code:verified-before], the
      //   URL stays [/verify-email] and [app-shell.nav.sign-in-link] shows
      await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
        'data-code',
        'verified-before',
      )
      await expect(page).toHaveURL(/\/verify-email(\?.*)?$/)
      await expect(page.getByTestId('app-shell.nav.sign-in-link')).toBeVisible()
    })

    await test.step('4. Click [user.verify-email.sign-in-link]', async () => {
      await page.getByTestId('user.verify-email.sign-in-link').click()
      // Expected: After step 4 the URL is [/sign-in]
      await expect(page).toHaveURL(/\/sign-in$/)
    })
  })
})
