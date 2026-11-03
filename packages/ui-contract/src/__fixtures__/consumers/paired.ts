// A code, a state or a value asserted on an anchor it may not carry: in a selector of its element
// (after a :has(...) the element before it goes on, a data-testid in :not(...) names none), or on
// the last getByTestId of the receiver's chain; another element, a variable, a helper name none.
import { expect, type Locator, type Page } from '@playwright/test'

const saveOf = (page: Page): Locator => page.getByTestId('sample.save-button')

export async function paired(page: Page): Promise<void> {
  const save = page.getByTestId('sample.save-button')

  await page.locator('[data-testid="sample.list"][data-state="current"]').waitFor()
  await page.locator('[data-code="failed"][data-testid="sample.save-button"]').waitFor()
  await page.locator('[data-testid="sample.thing-item"]:not([data-state="loading"])').count()
  await page.locator('[data-testid="sample.list"] [data-state="current"]').count()
  await expect(page.getByTestId('sample.save-button')).toHaveAttribute('data-state', 'current')
  await expect(
    page.getByTestId('sample.list').getByTestId('sample.thing-item').first(),
  ).not.toHaveAttribute('data-state', 'loading')
  await expect(page.getByTestId('sample.list').locator('li')).toHaveAttribute('data-code', 'saved')
  await expect(save).toHaveAttribute('data-state', 'current')
  await expect(saveOf(page)).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('sample.list')).toHaveAttribute('data-code', 'lost')
  await expect(page.getByTestId('sample.mode-select.option')).toHaveAttribute('data-value', 'a')
  await page
    .locator(
      '[data-testid="sample.list"]:has([data-testid="sample.thing-item"])[data-state="loading"]',
    )
    .count()
  await page
    .locator(
      '[data-testid="sample.list"]:has([data-testid="sample.thing-item"])[data-state="current"]',
    )
    .count()
  await page.locator('[data-code="saved"]:not([data-testid="sample.list"])').count()
}
