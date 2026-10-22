// Every literal here is one the sample contract knows: declared and derived anchors, codes,
// states and values (one of them matched by a pattern row), and the forms the check passes over.
import type { Page } from '@playwright/test'

export async function known(page: Page, code: string, id: string): Promise<void> {
  await page.getByTestId('sample.page').waitFor()
  await page.getByTestId('sample.mode-select.option').first().click()
  await page.locator('[data-testid="sample.save-button"][data-code="saved"]').waitFor()
  await page.locator("[data-testid='sample.list'][data-state='loading']").waitFor()
  await page.locator('[data-testid="sample.mode-select.option"][data-value="a"]').click()
  await page.locator('[data-testid="sample.key-select.option"][data-value="k12"]').click()
  await page
    .locator(`[data-testid="sample.thing-item"][data-state="current"][data-id="${id}"]`)
    .waitFor()
  await page.locator(`[data-testid="sample.save-button"][data-code="${code}"]`).waitFor()
  await page.locator('[data-testid^="sample."]').count()
  await page
    .getByTestId('sample.list')
    .getByTestId('sample.thing-item')
    .filter({ hasText: 'the title of the thing it shows' })
    .click()
}
