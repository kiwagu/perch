// spec: tests/e2e/specs/organisation/03-membership-change.md
import { generate } from '../support/data'
import { appReady, expect, signUp, test } from '../support/fixtures'

test.describe('Deliver an invitation and a removal to a signed-in device', { tag: '@full' }, () => {
  test('Device B gains the organisation when invited and loses it when removed, without a reload', async ({
    page,
    anotherAccount,
  }, testInfo) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
    }
    const { account: userB, page: deviceB } = anotherAccount
    // Full page loads of device B: the membership changes must reach it without one.
    let loadsOfB = 0

    deviceB.on('load', () => {
      loadsOfB += 1
    })

    await test.step('1. On device B, sign up as user B and open "/org"', async () => {
      // The fixture signed user B up through the sign-in page in a browser of its own.
      await expect(deviceB).toHaveURL(/\/me$/)
      await deviceB.getByTestId('app-shell.nav.organisation').click()
      // Expected: after step 1 device B shows "You are not a member of any organisation yet."
      await expect(deviceB.getByTestId('organisation.none')).toHaveText(
        'You are not a member of any organisation yet.',
      )
    })

    const userA =
      await test.step('2. On device A, sign up as user A, create the organisation and add the note by A', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation').click()
        await page.getByTestId('organisation.create.key').fill(data.key)
        await page.getByTestId('organisation.create.name').fill(data.name)
        await page.getByTestId('organisation.create.submit').click()
        await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
        await page.getByTestId('organisation.notes.input').fill(data.noteByA)
        await page.getByTestId('organisation.notes.add').click()
        await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])

        return account
      })

    await test.step('3. On device A, invite user B', async () => {
      // When device B shows the organisation and the note by A, read on the clock both
      // browsers share.
      const shownAt = deviceB
        .waitForFunction(
          ({ name, note }) =>
            document.querySelector('[data-testid="organisation.heading"]')?.textContent === name &&
            Array.from(document.querySelectorAll('[data-testid="organisation.notes.text"]')).some(
              (node) => node.textContent === note,
            ) &&
            Date.now(),
          { name: data.name, note: data.noteByA },
          { polling: 'raf', timeout: 5_000 },
        )
        .then((handle) => handle.jsonValue())

      // Awaited after the assertions below, which report a timeout better.
      shownAt.catch(() => undefined)
      await page.getByTestId('organisation.invite.email').fill(userB.email)

      const clickedAt = Date.now()

      await page.getByTestId('organisation.invite.submit').click()
      // Expected: within 5 seconds of step 3 device B shows the organisation and the note by A,
      // without a reload; the delay is reported as "membership-change-ms"
      await expect(deviceB.getByTestId('organisation.heading')).toHaveText(data.name, {
        timeout: 5_000,
      })
      await expect(deviceB.getByTestId('organisation.notes.text')).toHaveText([data.noteByA], {
        timeout: 5_000,
      })
      expect(loadsOfB, 'pages device B loaded since it signed up').toBe(0)

      const shown = await shownAt
      const latency = typeof shown === 'number' ? shown - clickedAt : Number.NaN

      expect(latency, 'the delay from the invitation to device B').toBeGreaterThanOrEqual(0)
      expect(latency, 'the delay from the invitation to device B').toBeLessThanOrEqual(5_000)
      testInfo.annotations.push({ type: 'membership-change-ms', description: String(latency) })
      await expect(page.getByTestId('organisation.invite.notice')).toHaveText('Invited')
      await expect(
        page.getByTestId('organisation.members.item').filter({ hasText: userB.email }),
      ).toBeVisible()
    })

    await test.step('4. On device A, click "Remove" next to user B', async () => {
      await page
        .getByTestId('organisation.members.item')
        .filter({ hasText: userB.email })
        .getByTestId('organisation.members.remove')
        .click()
    })

    // Expected:
    // - Within 5 seconds of step 4 device B shows "You are not a member of any organisation yet." again, without a reload, and its organisation data is gone from the device: a reload of "/org" still shows no organisation
    await expect(deviceB.getByTestId('organisation.none')).toHaveText(
      'You are not a member of any organisation yet.',
      { timeout: 5_000 },
    )
    expect(loadsOfB, 'pages device B loaded since it signed up').toBe(0)
    await deviceB.reload()
    await appReady(deviceB)
    // Once the sync channel is up the gateway has told the device its memberships again.
    await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
      timeout: 10_000,
    })
    await expect(deviceB).toHaveURL(/\/org$/)
    await expect(deviceB.getByTestId('organisation.none')).toHaveText(
      'You are not a member of any organisation yet.',
    )
    await expect(deviceB.getByTestId('organisation.heading')).toHaveCount(0)
    // - Device A shows the members list without user B
    await expect(
      page.getByTestId('organisation.members.item').filter({ hasText: userB.email }),
    ).toHaveCount(0)
    await expect(page.getByTestId('organisation.members.item')).toHaveText([userA.email])
  })
})
