// spec: tests/e2e/specs/sync/01-two-devices.md
import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'

test.describe('Keep one account in step on two devices', { tag: '@full' }, () => {
  test('A bio written on one device and a name changed on another reach both devices', async ({
    page,
    secondDevice,
  }, testInfo) => {
    const data = {
      bio: generate.bio(),
      newName: generate.newName(),
    }

    await test.step('1. On device A, open "/me" and wait for the app to be ready', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toBeVisible()
    })

    await test.step('2. On device A, enter the bio and click "Save"', async () => {
      await page.getByTestId('user.profile.bio-input').fill(data.bio)
      await page.getByTestId('user.profile.save').click()
      // Expected: after step 2 device A shows the notification "Saved"
      await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
    })

    const deviceB =
      await test.step('3. On device B, sign in with the same account and wait for "/me"', async () => {
        const b = await secondDevice.signIn()

        // Expected: after step 3 device B shows the bio entered on device A
        await expect(b.getByTestId('user.profile.bio-input')).toHaveValue(data.bio, {
          timeout: 10_000,
        })

        return b
      })

    const measure =
      await test.step('4. On device B, enter the new name and click "Save"', async () => {
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

        await deviceB.getByTestId('user.profile.save').click()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 4 device A shows the new name in the heading, without a reload
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName, {
      timeout: 5_000,
    })
    // - The time from the click on device B to the new name on device A is reported as "sync-latency-ms"
    const shownAt = await measure.shownAt
    const latency = typeof shownAt === 'number' ? shownAt - measure.clickedAt : Number.NaN

    expect(latency, 'the delay from the click to the new name').toBeGreaterThanOrEqual(0)
    expect(latency, 'the delay from the click to the new name').toBeLessThanOrEqual(5_000)
    testInfo.annotations.push({ type: 'sync-latency-ms', description: String(latency) })
  })
})
