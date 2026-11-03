// A code, a state or a value asserted on an anchor: in a selector of the same element, or on the
// last getByTestId of the receiver's chain; each one the anchor does not carry is a problem. The
// forms that name no anchor (another element, a variable, a helper) are held to the contract only.
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
}
