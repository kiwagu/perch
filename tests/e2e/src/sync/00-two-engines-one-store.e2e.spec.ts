// Checkpoint: two tabs of one browser, each with its own database engine on the same
// IndexedDB store, see each other's writes and report no engine error.
import type { Page } from '@playwright/test'

import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'

const ENGINE_ERROR = /database|engine|indexeddb|indxdb|wasm|transaction|surreal/i

/** Console errors and uncaught page errors that mention the database engine or its store. */
function engineErrors(page: Page): string[] {
  const seen: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error' && ENGINE_ERROR.test(message.text())) {
      seen.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    if (ENGINE_ERROR.test(`${error.name} ${error.message}`)) {
      seen.push(`${error.name}: ${error.message}`)
    }
  })

  return seen
}

async function rename(page: Page, name: string): Promise<void> {
  await page.getByTestId('user.profile.name-input').clear()
  await page.getByTestId('user.profile.name-input').fill(name)
  await page.getByTestId('user.profile.save').click()
  await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
  await expect(page.getByTestId('user.profile.heading')).toHaveText(name)
}

test.describe('Two tabs on one local store', () => {
  test('each tab sees what the other wrote, with no engine error', async ({
    page,
    context,
    signedIn,
  }) => {
    const errorsA = engineErrors(page)
    const first = generate.newName()
    const second = generate.newName()

    await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name)

    await test.step('1. Tab A renames the profile', async () => {
      await rename(page, first)
    })

    const other = await context.newPage()
    const errorsB = engineErrors(other)

    await test.step('2. Tab B opens "/me" and shows the new name', async () => {
      await other.goto('/me')
      await appReady(other)
      await expect(other.getByTestId('user.profile.heading')).toHaveText(first)
    })

    await test.step('3. Tab B renames the profile again', async () => {
      await rename(other, second)
    })

    await test.step('4. Tab A reloads and shows the name tab B saved', async () => {
      await page.reload()
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(second)
    })

    expect(errorsA, 'engine errors in tab A').toEqual([])
    expect(errorsB, 'engine errors in tab B').toEqual([])
  })
})
