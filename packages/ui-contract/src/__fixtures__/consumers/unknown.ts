// Literals the sample contract does not know: each one is a problem at its line.
import type { Page } from '@playwright/test'

export async function unknown(page: Page): Promise<void> {
  await page.getByTestId('sample.other-button').click()
  await page.locator('[data-testid="sample.gone-input"]').fill('x')
  await page.getByTestId('sample.list.option').click()
  await page.locator('[data-testid="sample.save-button"][data-code="lost"]').waitFor()
  await page.locator('[data-testid="sample.list"][data-state="stuck"]').waitFor()
  await page.locator('[data-testid="sample.mode-select.option"][data-value="c"]').click()
}
