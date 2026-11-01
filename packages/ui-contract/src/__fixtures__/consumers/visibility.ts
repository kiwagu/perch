// The eye of a password input: located by its derived anchor, its value asserted in a selector
// and with toHaveAttribute, and a value a visibility-button never carries.
import { expect, type Page } from '@playwright/test'

export async function visibility(page: Page): Promise<void> {
  const eye = page.getByTestId('sample.title-input.visibility-button')

  await page
    .locator('[data-testid="sample.title-input.visibility-button"][data-value="show"]')
    .click()
  await expect(eye).toHaveAttribute('data-value', 'hide')
  await expect(eye).toHaveAttribute('data-value', 'peek')
}
