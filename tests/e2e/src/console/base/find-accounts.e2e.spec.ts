// scenario: console/base/find-accounts
import {
  accountItems,
  chooseSize,
  consoleLink,
  expectAddress,
  expectRange,
  listedEmails,
  openUsers,
  searchAccounts,
  signUpOperator,
} from '../../support/console'
import { generate } from '../../support/data'
import { appReady, expect, startSignUp, test } from '../../support/fixtures'

/** The accounts a page holds while the address names no size. */
const DEFAULT_SIZE = 25

test.describe('Find accounts and page through them', { tag: '@full' }, () => {
  test('The operator finds eleven accounts by a part of their email, pages through them ten at a time, and sees them all at once with a larger page', async ({
    page,
    freshDevice,
  }) => {
    // Twelve accounts sign up, eleven of them one after another on device B.
    test.slow()

    const data = {
      operatorEmail: generate.operatorEmail(),
      operatorName: generate.operatorName(),
      emailPrefix: generate.emailPrefix(),
      password: generate.password(),
      name: generate.name(),
    }
    // Users 1 to 11 in the order they sign up, each with an email that starts with the prefix.
    const users = Array.from({ length: 11 }, (_, index) => ({
      ...generate.account(),
      email: generate.emailStartingWith(data.emailPrefix, index + 1),
      password: data.password,
      name: data.name,
    }))
    // The emails of user `newest` down to user `oldest`, as the list shows them, the newest first.
    const emailsOfUsers = (newest: number, oldest: number): string[] =>
      users
        .slice(oldest - 1, newest)
        .map((user) => user.email)
        .reverse()

    await test.step("1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page", async () => {
      await signUpOperator(page, {
        ...generate.account(),
        email: data.operatorEmail,
        password: data.password,
        name: data.operatorName,
      })
      // Expected: After step 1 [app-shell.nav] on device A shows [app-shell.nav.console-link]
      await expect(consoleLink(page)).toBeVisible()
    })

    await test.step('2. On device B, sign up user 1 to user 11 in that order, each with an email that starts with the email prefix, the password and the name, without opening their links', async () => {
      const deviceB = await freshDevice.open()

      // Each sign-up is answered before the next starts, so each account is newer than the last.
      for (const user of users) {
        await startSignUp(deviceB, user)
      }
    })

    await test.step('3. On device A, open [/console/users], enter the email prefix into [console.users.search-input] and click [console.users.search-button]', async () => {
      await openUsers(page)
      await searchAccounts(page, data.emailPrefix)
      // Expected: After step 3 the URL is [/console/users] with the email prefix as its search,
      //   [console.users.list] is in [state:ready] and holds eleven
      //   [console.users.list.account-item], the newest first, user 11's at the top, each with its
      //   [console.users.list.email-cell], its [console.users.list.name-cell] showing the name, no
      //   [console.users.list.verified-badge] and no [console.users.list.banned-badge];
      //   [console.users.list.range] says 1-11 of 11, and neither [console.users.list.previous-link]
      //   nor [console.users.list.next-link] shows
      await expectAddress(page, '/console/users', { q: data.emailPrefix })
      await expect(page.getByTestId('console.users.list')).toHaveAttribute('data-state', 'ready')
      await expect(accountItems(page)).toHaveCount(11)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(11, 1))
      await expect(
        page.getByTestId('console.users.list').getByTestId('console.users.list.name-cell'),
      ).toHaveText(users.map(() => data.name))
      await expect(
        page.getByTestId('console.users.list').getByTestId('console.users.list.verified-badge'),
      ).toHaveCount(0)
      await expect(
        page.getByTestId('console.users.list').getByTestId('console.users.list.banned-badge'),
      ).toHaveCount(0)
      await expectRange(page, { from: 1, to: 11, total: 11 })
      await expect(page.getByTestId('console.users.list.previous-link')).toHaveCount(0)
      await expect(page.getByTestId('console.users.list.next-link')).toHaveCount(0)
    })

    await test.step('4. On device A, in [console.users.list.size-select] choose [value:10]', async () => {
      await chooseSize(page, 10)
      // Expected: After step 4 the URL carries the size 10 and no page, [console.users.list] holds
      //   ten [console.users.list.account-item], user 11's to user 2's, [console.users.list.range]
      //   says 1-10 of 11, [console.users.list.next-link] shows and
      //   [console.users.list.previous-link] does not
      await expectAddress(page, '/console/users', { q: data.emailPrefix, size: '10' })
      await expect(accountItems(page)).toHaveCount(10)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(11, 2))
      await expectRange(page, { from: 1, to: 10, total: 11 })
      await expect(page.getByTestId('console.users.list.next-link')).toBeVisible()
      await expect(page.getByTestId('console.users.list.previous-link')).toHaveCount(0)
    })

    await test.step('5. On device A, click [console.users.list.next-link]', async () => {
      await page.getByTestId('console.users.list.next-link').click()
      // Expected: After step 5 the URL carries the size 10 and the page 2, [console.users.list]
      //   holds one [console.users.list.account-item], user 1's, [console.users.list.range] says
      //   11-11 of 11, [console.users.list.previous-link] shows and [console.users.list.next-link]
      //   does not
      await expectAddress(page, '/console/users', { q: data.emailPrefix, size: '10', page: '2' })
      await expect(accountItems(page)).toHaveCount(1)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(1, 1))
      await expectRange(page, { from: 11, to: 11, total: 11 })
      await expect(page.getByTestId('console.users.list.previous-link')).toBeVisible()
      await expect(page.getByTestId('console.users.list.next-link')).toHaveCount(0)
    })

    await test.step('6. On device A, reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 6 the page is the same: one [console.users.list.account-item], user
      //   1's, [console.users.list.range] saying 11-11 of 11, and [console.users.search-input]
      //   holding the email prefix
      await expectAddress(page, '/console/users', { q: data.emailPrefix, size: '10', page: '2' })
      await expect(page.getByTestId('console.users.list')).toHaveAttribute('data-state', 'ready')
      await expect(accountItems(page)).toHaveCount(1)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(1, 1))
      await expectRange(page, { from: 11, to: 11, total: 11 })
      await expect(page.getByTestId('console.users.search-input')).toHaveValue(data.emailPrefix)
    })

    await test.step('7. On device A, click [console.users.list.previous-link]', async () => {
      await page.getByTestId('console.users.list.previous-link').click()
      // Expected: After step 7 the URL carries the size 10 and no page, and [console.users.list]
      //   holds ten [console.users.list.account-item] again
      await expectAddress(page, '/console/users', { q: data.emailPrefix, size: '10' })
      await expect(accountItems(page)).toHaveCount(10)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(11, 2))
    })

    await test.step('8. On device A, in [console.users.list.size-select] choose [value:25]', async () => {
      await chooseSize(page, DEFAULT_SIZE)
      // Expected: After step 8 the URL carries neither the size nor the page, 25 being the size a
      //   list has by default, and [console.users.list] holds eleven
      //   [console.users.list.account-item] with [console.users.list.range] saying 1-11 of 11
      await expectAddress(page, '/console/users', { q: data.emailPrefix })
      await expect(accountItems(page)).toHaveCount(11)
      await expect(listedEmails(page)).toHaveText(emailsOfUsers(11, 1))
      await expectRange(page, { from: 1, to: 11, total: 11 })
    })

    await test.step('9. On device A, clear [console.users.search-input] and click [console.users.search-button]', async () => {
      await page.getByTestId('console.users.search-input').clear()
      await page.getByTestId('console.users.search-button').click()
      // Expected: After step 9 the URL carries neither the search, the page nor the size;
      //   [console.users.list] holds the platform's newest accounts, at least twelve and at most
      //   25, since the stand's other tests sign accounts up too, and [console.users.list.range]
      //   counts from 1 to the number it holds
      await expectAddress(page, '/console/users', {})
      // The run decides only the twelve accounts this test made: the tests of the other worker
      // sign accounts up on the same stand meanwhile, so the page holds at least those twelve and
      // at most a page of the default size. The search's page held eleven, so twelve or more are
      // the new read's.
      await expect
        .poll(() => accountItems(page).count(), { message: 'the accounts the page holds' })
        .toBeGreaterThanOrEqual(12)
      await expect(page.getByTestId('console.users.list')).toHaveAttribute('data-state', 'ready')

      const held = await accountItems(page).count()

      expect(held, 'the accounts the page holds').toBeLessThanOrEqual(DEFAULT_SIZE)
      await expect(page.getByTestId('console.users.list.range')).toHaveAttribute('data-from', '1')
      await expect(page.getByTestId('console.users.list.range')).toHaveAttribute(
        'data-to',
        String(held),
      )
    })

    await test.step('10. On device A, enter the operator email into [console.users.search-input] and click [console.users.search-button]', async () => {
      await searchAccounts(page, data.operatorEmail)
      // Expected: After step 10 [console.users.list] holds one [console.users.list.account-item],
      //   device A's own, with its [console.users.list.operator-badge] and its
      //   [console.users.list.verified-badge]
      await expectAddress(page, '/console/users', { q: data.operatorEmail })
      await expect(accountItems(page)).toHaveCount(1)
      // Device A's own: the account of the operator email it signed up with.
      await expect(listedEmails(page)).toHaveText([data.operatorEmail])
      await expect(
        accountItems(page).getByTestId('console.users.list.operator-badge'),
      ).toBeVisible()
      await expect(
        accountItems(page).getByTestId('console.users.list.verified-badge'),
      ).toBeVisible()
    })
  })
})
