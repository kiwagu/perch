// biome-ignore-all lint/style/useTemplate: the fixture concatenates on purpose
// Selectors whose attribute name a + chain or an escape splits: no line of this file spells an
// attribute name in full, only the folded text of each string does.
import type { Page } from '@playwright/test'

export async function splitName(page: Page, id: string): Promise<void> {
  await page.locator('[data-' + 'testid="' + id + '"]').click()
  await page.locator('[data-' + 'testid="' + 'sample.gone-page' + '"]').click()
  await page.locator('[data-' + 'testid="' + 'sample.page' + '"]').click()
  await page.locator('[data-\x74estid="sample.list"]').click()
}
