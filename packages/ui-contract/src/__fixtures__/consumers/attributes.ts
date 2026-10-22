// The attributes a test asserts with toHaveAttribute: codes, a state, values and an anchor, the
// same with .not, a value from a parameter, and attributes the check does not read.
import { expect, type Page } from '@playwright/test'

export async function attributes(page: Page, code: string): Promise<void> {
  const save = page.getByTestId('sample.save-button')
  const list = page.getByTestId('sample.list')

  await expect(save).toHaveAttribute('data-code', 'saved')
  await expect(save).toHaveAttribute('data-code', 'lost')
  await expect(list).toHaveAttribute('data-state', 'loading')
  await expect(save).not.toHaveAttribute('data-code', 'failed')
  await expect(page.getByTestId('sample.mode-select.option').first()).not.toHaveAttribute(
    'data-value',
    'c',
  )
  await expect(list).toHaveAttribute('data-testid', 'sample.list')
  await expect(save).toHaveAttribute('data-code', code)
  await expect(save).toHaveAttribute('data-id', 'thg-1')
  await expect(save).toHaveAttribute('aria-label', 'Save')
  await expect(save).toHaveAttribute('data-state')
}
