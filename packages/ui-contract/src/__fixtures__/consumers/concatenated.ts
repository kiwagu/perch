// biome-ignore-all lint/style/useTemplate: the fixture concatenates on purpose
// Selectors and anchors put together with +: one string when every operand is a string, an
// anchor built at runtime when an expression completes it.
import type { Page } from '@playwright/test'

export async function concatenated(page: Page, id: string, code: string): Promise<void> {
  await page.locator('[data-testid="' + id + '"]').waitFor()
  await page.locator('[data-testid="' + 'sample.gone-page' + '"]').waitFor()
  await page.locator('[data-testid="' + ('sample.page' as const) + '"]').waitFor()
  await page.locator('[data-testid="sample.save-button"][data-code="' + code + '"]').waitFor()
  await page.locator('[data-testid=' + JSON.stringify(id) + ']').waitFor()
  await page.getByTestId('sample.' + 'list').waitFor()
  await page.getByTestId('sample.' + id).waitFor()
}
