// scenario: organisation/flows/default-language

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { generate } from '../../support/data'
import {
  expect,
  expectPathname,
  notice,
  signIn,
  signUp,
  startSignUp,
  test,
} from '../../support/fixtures'
import { openDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import {
  acceptOnOrg,
  chooseDefaultLanguage,
  createOrganisation,
  expectInvitationMail,
  inviteEmail,
  removeDefaultLanguage,
} from '../../support/organisation'

test.describe("An invited account starts in its organisation's default language", {
  tag: '@full',
}, () => {
  test("An admin sets the organisation's default language; an account its invitation creates starts in it, the member's own choice wins afterwards, and once the admin removes it a new account starts in its sign-up's language", async ({
    page,
    freshDevices,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      invitedEmail: generate.email(),
      secondInvitedEmail: generate.email(),
      password: generate.password(),
      userName: generate.name(),
    }
    const select = (device: typeof page) =>
      device.getByTestId('organisation.settings.locale-select')
    const clear = (device: typeof page) => device.getByTestId('organisation.settings.clear-button')
    const settingsLanguage = (device: typeof page) =>
      device.getByTestId('user.settings.locale-select')

    const userA =
      await test.step('1. On device A, sign up as user A, open the link of its [mail:sign-up], open [screen:organisation], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        await createOrganisation(page, data)

        return account
      })

    const deviceD =
      await test.step('2. On device A, wait for [organisation.settings.locale-select] to be enabled and in [organisation.settings.locale-select] choose [value:es]; on device D, sign in as user A, open [screen:organisation] and wait for [organisation.settings.locale-select] to show [value:es]', async () => {
        await chooseDefaultLanguage(page, 'es')

        const d = await freshDevices.open()

        await signIn(d, userA)
        await d.getByTestId('app-shell.nav.organisation-link').click()
        await expect(select(d)).toHaveAttribute('data-value', 'es', { timeout: 15_000 })
        // Expected: After step 2 [organisation.settings.locale-select] shows [value:es] on devices A
        //   and D: device D got it from the server, which holds it, and no
        //   [app-shell.notice-message] carries [code:change-rejected] on device A
        await expect(select(page)).toHaveAttribute('data-value', 'es')
        await expect(notice(page, 'change-rejected')).toHaveCount(0)

        return d
      })

    await test.step('3. On device A, enter the invited email into [organisation.invite.email-input], click [organisation.invite.submit-button] and wait for [app-shell.toast] to carry [code:invited]', async () => {
      const seen = await mailbox.count(data.invitedEmail)

      await inviteEmail(page, data.invitedEmail)
      // Expected: After step 3 the invitation is pending, and [mail:organisations.invite] reaches
      //   the invited email in the language [value:es], the organisation's, as no account has that
      //   email yet
      await expectInvitationMail(
        {
          email: data.invitedEmail,
          inviter: { email: userA.email, language: 'en' },
          organisationLanguage: 'es',
        },
        seen,
      )
    })

    const deviceB =
      await test.step('4. On device B, open [screen:user.sign-in], sign up with the invited email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]', async () => {
        const b = await freshDevices.open()
        const invited = {
          ...generate.account(),
          email: data.invitedEmail,
          password: data.password,
          name: data.userName,
        }
        // The invitation's mail came first: the sign-up's is the next one.
        const seen = await mailbox.count(data.invitedEmail)

        await startSignUp(b, invited, 'en')
        // Expected: After step 4 [mail:sign-up] reaches the invited email in the language
        //   [value:es], the organisation's, though the sign-up page spoke English, and
        //   [user.settings.locale-select] shows [value:es]
        await openDeclaredMail(
          b,
          'sign-up',
          {
            params: { email: data.invitedEmail, locale: 'en' },
            account: { email: data.invitedEmail, language: 'es' },
          },
          seen,
        )
        await expectPathname(b, CONTRACT_ROUTES['user.profile'])
        await b.getByTestId('app-shell.nav.settings-link').click()
        await expect(settingsLanguage(b)).toHaveAttribute('data-value', 'es', { timeout: 10_000 })

        return b
      })

    await test.step("5. On device B, open [screen:organisation] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]", async () => {
      await acceptOnOrg(deviceB, data.name)
      // Expected: After step 5 device B shows [organisation.page.role-badge] carrying
      //   [value:member] and no [organisation.settings.locale-select]
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(select(deviceB)).toHaveCount(0)
    })

    await test.step('6. On device B, click [app-shell.nav.settings-link], in [user.settings.locale-select] choose [value:en], then reload the page and wait for [user.settings.locale-select] to be enabled', async () => {
      await deviceB.getByTestId('app-shell.nav.settings-link').click()
      await expect(settingsLanguage(deviceB)).toBeEnabled()
      await settingsLanguage(deviceB).click()
      await deviceB
        .locator('[data-testid="user.settings.locale-select.option"][data-value="en"]')
        .click()
      await expect(settingsLanguage(deviceB)).toHaveAttribute('data-value', 'en')
      // The store has ended once the select takes a choice again: the reload cannot race it.
      await expect(settingsLanguage(deviceB)).toBeEnabled()
      await deviceB.reload()
      await expect(settingsLanguage(deviceB)).toBeEnabled({ timeout: 10_000 })
      // Expected: After step 6 [user.settings.locale-select] still shows [value:en]: the member's
      //   own language wins over the organisation's
      await expect(settingsLanguage(deviceB)).toHaveAttribute('data-value', 'en')
    })

    await test.step('7. On device A, reload [screen:organisation]', async () => {
      await page.reload()
      // Expected: After step 7 [organisation.settings.locale-select] still shows [value:es] on
      //   device A, with [organisation.settings.clear-button] beside it
      await expect(select(page)).toHaveAttribute('data-value', 'es', { timeout: 10_000 })
      await expect(clear(page)).toBeVisible()
    })

    await test.step('8. On device A, click [organisation.settings.clear-button]; on device D, still on [screen:organisation], wait for [organisation.settings.clear-button] to be gone', async () => {
      await expect(clear(page)).toBeEnabled()
      await removeDefaultLanguage(page)
      await expect(clear(deviceD)).toHaveCount(0, { timeout: 15_000 })
      // Expected: After step 8 [organisation.settings.clear-button] is gone on devices A and D:
      //   device D got the removal from the server, which holds it, and no
      //   [app-shell.notice-message] carries [code:change-rejected] on device A
      await expect(clear(page)).toHaveCount(0)
      await expect(notice(page, 'change-rejected')).toHaveCount(0)
    })

    await test.step('9. On device A, enter the second invited email into [organisation.invite.email-input], click [organisation.invite.submit-button] and wait for [app-shell.toast] to carry [code:invited]', async () => {
      const seen = await mailbox.count(data.secondInvitedEmail)

      await inviteEmail(page, data.secondInvitedEmail)
      // Expected: After step 9 [mail:organisations.invite] reaches the second invited email in the
      //   language [value:en]: the organisation's default was removed, so the built-in English speaks
      await expectInvitationMail(
        {
          email: data.secondInvitedEmail,
          inviter: { email: userA.email, language: 'en' },
          organisationLanguage: 'en',
        },
        seen,
      )
    })

    await test.step('10. On device C, open [screen:user.sign-in], sign up with the second invited email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]', async () => {
      const c = await freshDevices.open()
      const invited = {
        ...generate.account(),
        email: data.secondInvitedEmail,
        password: data.password,
        name: data.userName,
      }
      const seen = await mailbox.count(data.secondInvitedEmail)

      await startSignUp(c, invited, 'en')
      // Expected: After step 10 [mail:sign-up] reaches the second invited email in the language
      //   [value:en] and [user.settings.locale-select] shows [value:en] on device C: with no
      //   default, the account starts in its sign-up page's language
      await openDeclaredMail(
        c,
        'sign-up',
        {
          params: { email: data.secondInvitedEmail, locale: 'en' },
          account: { email: data.secondInvitedEmail, language: 'en' },
        },
        seen,
      )
      await expectPathname(c, CONTRACT_ROUTES['user.profile'])
      await c.getByTestId('app-shell.nav.settings-link').click()
      await expect(settingsLanguage(c)).toHaveAttribute('data-value', 'en', { timeout: 10_000 })
    })
  })
})
