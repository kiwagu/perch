// scenario: user/base/sign-up
import { generate } from '../../support/data'
import { appReady, checkYourMail, expect, notice, test } from '../../support/fixtures'
import { openDeclaredMail } from '../../support/mail-contract'

test.describe('Sign up, verify the email and see the profile', { tag: '@smoke' }, () => {
  test('A new user signs up, opens the link of the verification mail and lands on the profile page', async ({
    page,
  }, testInfo) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }
    const onPhone = testInfo.project.name === 'mobile'

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)

      if (onPhone) {
        await expect(page).toHaveScreenshot('sign-in.png')
      }
    })

    await test.step('2. Click [user.sign-in.toggle-button]', async () => {
      await expect(page.getByTestId('user.sign-in.toggle-button')).toHaveAttribute(
        'data-value',
        'sign-up',
      )
      await page.getByTestId('user.sign-in.toggle-button').click()
    })

    await test.step('3. Enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]', async () => {
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
    })

    await test.step('4. Click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 4 [user.sign-in.mail-message] carries [code:check-your-mail],
      //   [user.sign-in.resend-button] shows, no [user.sign-in.name-input] shows, the URL stays
      //   [/sign-in], and [mail:sign-up] reaches the email (step 5 waits for it)
      await expect(checkYourMail(page)).toBeVisible()
      await expect(page.getByTestId('user.sign-in.resend-button')).toBeVisible()
      await expect(page.getByTestId('user.sign-in.name-input')).toHaveCount(0)
      await expect(page).toHaveURL(/\/sign-in$/)
    })

    await test.step('5. Open the link of [mail:sign-up]', async () => {
      // The mail to the email, held to its declaration: the link opens [/verify-email] with its
      // token, in the language of the sign-up.
      await openDeclaredMail(page, 'sign-up', { params: { email: data.email, locale: 'en' } })
    })

    // Expected:
    // - After step 5 the link opens [/verify-email], then [app-shell.notice-message] carries
    //   [code:welcome], the URL is [/me] and [user.profile.heading] shows the entered name
    await expect(notice(page, 'welcome')).toBeVisible()
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
    // - [user.profile.email-input] shows the entered email
    await expect(page.getByTestId('user.profile.email-input')).toHaveValue(data.email)

    if (onPhone) {
      // Settled once the frame shows a signed-in account's navigation, its settings link last,
      // and its sync has sent what the verification wrote.
      await expect(page.getByTestId('app-shell.nav.settings-link')).toBeVisible()
      await expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute(
        'data-code',
        'synced',
        { timeout: 15_000 },
      )
      await expect(page).toHaveScreenshot('profile.png', {
        mask: [
          page.getByTestId('user.profile.heading'),
          page.getByTestId('user.profile.email-input'),
          page.getByTestId('user.profile.name-input'),
        ],
      })
    }

    // - Reloading the page keeps the user signed in and shows the same name
    await page.reload()
    await appReady(page)
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
  })
})
