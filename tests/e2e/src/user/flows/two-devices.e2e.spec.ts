// scenario: user/flows/two-devices
import { generate } from '../../support/data'
import { appReady, expect, test, toast } from '../../support/fixtures'

test.describe('Keep one account in step on two devices', { tag: '@full' }, () => {
  test('A bio written on one device and a name changed on another reach both devices, and a name being typed is not overwritten', async ({
    page,
    secondDevice,
  }, testInfo) => {
    const data = {
      bio: generate.bio(),
      newName: generate.newName(),
      draftName: generate.newName(),
      secondName: generate.newName(),
    }

    await test.step('1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toBeVisible()
    })

    await test.step('2. On device A, enter the bio into [user.profile.bio-textarea] and click [user.profile.save-button]', async () => {
      await page.getByTestId('user.profile.bio-textarea').fill(data.bio)
      await page.getByTestId('user.profile.save-button').click()
      // Expected: After step 2 device A shows [app-shell.toast] carrying
      //   [code:profile-saved]
      await expect(toast(page, 'profile-saved')).toBeVisible()
    })

    const deviceB =
      await test.step('3. On device B, sign in with the same account and wait for [/me]', async () => {
        const b = await secondDevice.signIn()

        // Expected: After step 3 device B shows the bio entered on device A in
        //   [user.profile.bio-textarea]
        await expect(b.getByTestId('user.profile.bio-textarea')).toHaveValue(data.bio, {
          timeout: 10_000,
        })

        return b
      })

    const measure =
      await test.step('4. On device B, enter the new name into [user.profile.name-input] and click [user.profile.save-button]', async () => {
        // When device A's heading shows the new name, read on the clock both browsers share.
        const shownAt = page
          .waitForFunction(
            (name) =>
              document.querySelector('[data-testid="user.profile.heading"]')?.textContent ===
                name && Date.now(),
            data.newName,
            { polling: 'raf', timeout: 5_000 },
          )
          .then((handle) => handle.jsonValue())

        // Awaited after the assertion below, which reports a timeout better.
        shownAt.catch(() => undefined)
        await deviceB.getByTestId('user.profile.name-input').fill(data.newName)

        const clickedAt = Date.now()

        await deviceB.getByTestId('user.profile.save-button').click()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 4 device A shows the new name in [user.profile.heading], without a
    //   reload
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName, {
      timeout: 5_000,
    })
    // - The time from the click on device B to the new name on device A is reported as
    //   "sync-latency-ms"
    const shownAt = await measure.shownAt
    const latency = typeof shownAt === 'number' ? shownAt - measure.clickedAt : Number.NaN

    expect(latency, 'the delay from the click to the new name').toBeGreaterThanOrEqual(0)
    expect(latency, 'the delay from the click to the new name').toBeLessThanOrEqual(5_000)
    testInfo.annotations.push({ type: 'sync-latency-ms', description: String(latency) })

    await test.step('5. On device A, enter the draft name into [user.profile.name-input] without saving', async () => {
      await page.getByTestId('user.profile.name-input').fill(data.draftName)
    })

    await test.step('6. On device B, enter the second name into [user.profile.name-input] and click [user.profile.save-button]', async () => {
      await deviceB.getByTestId('user.profile.name-input').fill(data.secondName)
      await deviceB.getByTestId('user.profile.save-button').click()
      // Expected: After step 6 device A shows the second name in [user.profile.heading] and still
      //   holds the draft name in [user.profile.name-input]
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.secondName, {
        timeout: 5_000,
      })
      await expect(page.getByTestId('user.profile.name-input')).toHaveValue(data.draftName)
    })

    await test.step('7. On device A, click [user.profile.save-button]', async () => {
      await page.getByTestId('user.profile.save-button').click()
      // Expected: After step 7 device B shows the draft name in [user.profile.heading] and in
      //   [user.profile.name-input]
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.draftName, {
        timeout: 5_000,
      })
      await expect(deviceB.getByTestId('user.profile.name-input')).toHaveValue(data.draftName)
    })
  })
})
