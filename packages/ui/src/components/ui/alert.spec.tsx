import { cleanup, render, screen } from '@testing-library/react'
import { CircleCheckIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/ui/alert'

/** The utility that hands the alert's colour down to its description. */
const DESCRIPTION_IN_TONE = '*:data-[slot=alert-description]:text-current'

function renderAlert(variant?: ComponentProps<typeof Alert>['variant']) {
  render(
    <Alert variant={variant}>
      <CircleCheckIcon aria-hidden />
      <AlertTitle>Saved</AlertTitle>
      <AlertDescription>The profile is up to date.</AlertDescription>
    </Alert>,
  )

  return {
    alert: screen.getByRole('alert').className.split(' '),
    description: screen.getByText('The profile is up to date.').className.split(' '),
  }
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('Alert', () => {
  it('stays plain on the card by default, its description muted', () => {
    const { alert, description } = renderAlert()

    expect(alert).toContain('bg-card')
    expect(alert).toContain('text-card-foreground')
    expect(alert).not.toContain(DESCRIPTION_IN_TONE)
    expect(description).toContain('text-muted-foreground')
  })

  it.each(['success', 'warning', 'info', 'destructive'] as const)(
    'gives the %s tone to the alert, its description and its icon, on the card',
    (tone) => {
      const { alert } = renderAlert(tone)

      expect(alert).toContain('bg-card')
      expect(alert).toContain(`text-${tone}`)
      expect(alert).toContain(DESCRIPTION_IN_TONE)
      expect(alert).toContain('*:[svg]:text-current')
      expect(alert).not.toContain('text-card-foreground')
    },
  )
})
