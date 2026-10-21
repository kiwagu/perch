// scenario: sync/03-one-leader-per-browser
import type { Page } from '@playwright/test'

import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'

/** Whether each tab leads the sync of its browser, as `<html data-sync-leader>` says. */
const leading = (tabs: readonly Page[]): Promise<Array<string | null>> =>
  Promise.all(tabs.map((tab) => tab.locator('html').getAttribute('data-sync-leader')))

test.describe('Sync from one tab per browser', { tag: '@full' }, () => {
  test("Two tabs of one browser share one sync leader, both tabs' edits reach the other device, and the other tab takes over when the leader closes", async ({
    page,
    secondDevice,
  }) => {
    const data = {
      newName: generate.newName(),
      secondName: generate.newName(),
      bio: generate.bio(),
    }

    await test.step('1. On device A, open "/me" in a first tab and wait for the app to be ready', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toBeVisible()
    })

    const { leader, follower } =
      await test.step('2. On device A, open "/me" in a second tab and wait for the app to be ready', async () => {
        const second = await page.context().newPage()

        await second.goto('/me')
        await appReady(second)
        await expect(second.getByTestId('user.profile.heading')).toBeVisible()

        // Expected: after step 2 exactly one of the two tabs of device A leads the sync, and
        // only that tab holds a sync channel
        const tabs = [page, second] as const

        await expect
          .poll(async () => (await leading(tabs)).toSorted(), { timeout: 10_000 })
          .toEqual(['0', '1'])

        const first = (await leading(tabs))[0] === '1'
        const leader = first ? page : second
        const follower = first ? second : page

        await expect(leader.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })
        await expect(follower.locator('html')).toHaveAttribute('data-sync-channel', 'down')

        return { leader, follower }
      })

    const deviceB =
      await test.step('3. On device B, sign in with the same account and wait for "/me"', async () => {
        const b = await secondDevice.signIn()

        await expect(b.getByTestId('user.profile.heading')).toBeVisible({ timeout: 10_000 })

        return b
      })

    await test.step('4. In the tab of device A that does not lead the sync, enter the new name and click "Save"', async () => {
      await follower.getByTestId('user.profile.name-input').fill(data.newName)
      await follower.getByTestId('user.profile.save').click()
      await expect(follower.getByTestId('user.profile.notice')).toHaveText('Saved')
      // Expected: within 5 seconds of step 4 device B shows the new name
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.newName, {
        timeout: 5_000,
      })
    })

    await test.step('5. On device A, enter the second name in the tab that leads the sync and the bio in the other tab, then click "Save" in both tabs at the same moment', async () => {
      await leader.getByTestId('user.profile.name-input').fill(data.secondName)
      await follower.getByTestId('user.profile.bio-input').fill(data.bio)
      // Both tabs append to the browser's one update log at once: neither edit may be lost.
      await Promise.all([
        leader.getByTestId('user.profile.save').click(),
        follower.getByTestId('user.profile.save').click(),
      ])
      // Expected: within 5 seconds of step 5 device B shows the second name and the bio: the
      // edit of each tab arrives
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.secondName, {
        timeout: 5_000,
      })
      await expect(deviceB.getByTestId('user.profile.bio-input')).toHaveValue(data.bio, {
        timeout: 5_000,
      })
    })

    await test.step('6. Close the tab of device A that leads the sync', async () => {
      await leader.close()
    })

    // Expected:
    // - Within 2 seconds of step 6 the remaining tab of device A leads the sync, and its sync channel then comes up
    await expect(follower.locator('html')).toHaveAttribute('data-sync-leader', '1', {
      timeout: 2_000,
    })
    await expect(follower.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
      timeout: 10_000,
    })
  })
})
