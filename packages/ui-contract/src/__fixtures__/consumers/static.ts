// A static string in every form the scan reads (quotes, a template without ${}, a TypeScript
// wrapper), and a name, a call or a template with ${} in its place.
import { expect, type Page } from '@playwright/test'

const ANCHOR = 'sample.page'
const anchorOf = (screen: string): string => `${screen}.page`
const stateOf = (ready: boolean): string => (ready ? 'ready' : 'loading')

export async function statics(page: Page, ready: boolean): Promise<void> {
  const list = page.getByTestId(`sample.list`)
  const item = page.getByTestId('sample.thing-item' as const)

  await expect(list).toHaveAttribute(`data-state`, `loading`)
  await expect(item).toHaveAttribute('data-state', 'current' satisfies string)
  await page.getByTestId(`${ANCHOR}`).waitFor()
  await page.getByTestId(ANCHOR).waitFor()
  await page.getByTestId(anchorOf('sample')).waitFor()
  await expect(list).toHaveAttribute('data-state', stateOf(ready))
  await expect(list).toHaveAttribute('data-testid', anchorOf('sample'))
}
