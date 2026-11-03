import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button, buttonVariants } from '@workspace/ui/components/ui/button'

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

describe('Button', () => {
  it('renders its label and reports clicks', async () => {
    const onClick = vi.fn()

    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('the destructive Button', () => {
  const classes = buttonVariants({ variant: 'destructive' }).split(' ')
  const SURFACES = ['card', 'background'] as const
  /** The utility that tints the button in each state. */
  const STATES = { 'at rest': 'bg-destructive', 'on hover': 'hover:bg-destructive' } as const

  type State = keyof typeof STATES
  type Surface = (typeof SURFACES)[number]

  /** What the button shows behind its text: its tint in the state, painted on the surface. */
  const groundOf = (theme: Theme, state: State, surface: Surface) =>
    over(
      themeColor(theme, 'destructive'),
      themeColor(theme, surface),
      tintOf(classes, STATES[state], theme),
    )

  it.each(
    THEMES.flatMap((theme) =>
      SURFACES.flatMap((surface) =>
        (['at rest', 'on hover'] as const).map((state) => [state, surface, theme] as const),
      ),
    ),
  )('reads at 4.5:1 or more %s on the %s, in %s', (state, surface, theme) => {
    expect(
      contrast(themeColor(theme, 'destructive'), groundOf(theme, state, surface)),
    ).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(THEMES.flatMap((theme) => SURFACES.map((surface) => [surface, theme] as const)))(
    'shows its hover apart from its rest on the %s, in %s',
    (surface, theme) => {
      expect(
        difference(groundOf(theme, 'at rest', surface), groundOf(theme, 'on hover', surface)),
      ).toBeGreaterThanOrEqual(NOTICEABLE)
    },
  )
})
