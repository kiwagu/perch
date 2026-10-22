// An anchor built at runtime is a problem; a code, a state or a value from a parameter is not.
import type { Page } from '@playwright/test'

const ANCHOR = 'sample.page'

export async function runtime(page: Page, screen: string, state: string): Promise<void> {
  await page.getByTestId(ANCHOR).waitFor()
  await page.getByTestId(`${screen}.page`).waitFor()
  await page.locator(`[data-testid="${screen}.page"]`).waitFor()
  await page.locator(`[data-testid="sample.page"][data-state="${state}"]`).waitFor()
}
