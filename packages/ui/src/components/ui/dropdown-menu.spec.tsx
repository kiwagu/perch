import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/ui/dropdown-menu'

import {
  AA_TEXT,
  contrast,
  difference,
  NOTICEABLE,
  over,
  THEMES,
  type Theme,
  themeColor,
  tintOf,
} from '../../styles/__fixtures__/theme-contrast'

/** The classes of an open menu's destructive item. */
function destructiveItemClasses(): readonly string[] {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  )

  return screen.getByRole('menuitem', { name: 'Delete' }).className.split(' ')
}

/** At rest the item shows the menu's popover; focused, its tint painted on it. */
function groundsOf(theme: Theme) {
  const popover = themeColor(theme, 'popover')
  const tint = tintOf(
    destructiveItemClasses(),
    'data-[variant=destructive]:focus:bg-destructive',
    theme,
  )

  return { rest: popover, focus: over(themeColor(theme, 'destructive'), popover, tint) }
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('the destructive menu item', () => {
  it.each(THEMES)('reads at 4.5:1 or more at rest and focused, in %s', (theme) => {
    const text = themeColor(theme, 'destructive')
    const { rest, focus } = groundsOf(theme)

    expect(contrast(text, rest)).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrast(text, focus)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(THEMES)('shows its focus apart from its rest, in %s', (theme) => {
    const { rest, focus } = groundsOf(theme)

    expect(difference(rest, focus)).toBeGreaterThanOrEqual(NOTICEABLE)
  })
})
