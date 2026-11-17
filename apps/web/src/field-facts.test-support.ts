import type { RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { expect } from 'vitest'

import type { FieldFactsByAnchor } from '@workspace/ui/field-facts'

import { stateColoursOf } from './field-state-colour.test-support'
import { FIELD_FACTS } from './platform/field-facts.gen'
import { type RenderOptions, renderWithProviders } from './test-utils'

/**
 * Renders a view the way the app does, inside the provider of the generated field facts, so a
 * field takes the limit, the type and the state colour the contract gives its anchor. Like
 * `renderWithProviders`, whose providers wrap the component, `rerender` keeps them.
 */
export function renderWithFacts(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  return renderWithProviders(ui, { ...options, facts: FIELD_FACTS })
}

/**
 * Holds each field the container renders that the facts declare, found by its `data-testid`, to
 * what they say: its limit (none when they give none), its type when they give one, and no state
 * colour when they opt it out. It answers the anchors it held, and fails when none was rendered:
 * a container with no declared field proves nothing. A caller whose field renders in a portal
 * passes `document.body`; a spec of the helper itself passes its own `facts`.
 */
export function expectFieldFacts(
  container: HTMLElement,
  facts: FieldFactsByAnchor = FIELD_FACTS,
): readonly string[] {
  const declared = [...container.querySelectorAll<HTMLElement>('[data-testid]')].filter((field) =>
    Object.hasOwn(facts, field.dataset['testid'] ?? ''),
  )

  expect(declared.length, 'the container renders no field the facts declare').toBeGreaterThan(0)

  return declared.map((field) => {
    const anchor = field.dataset['testid'] ?? ''
    const { maxLength, type, marksState } = facts[anchor] ?? {}

    expect(field.getAttribute('maxlength'), `${anchor}: its maxlength`).toBe(
      maxLength === undefined ? null : String(maxLength),
    )

    if (type !== undefined) {
      expect(field.getAttribute('type'), `${anchor}: its type`).toBe(type)
    }

    if (marksState === false) {
      expect(stateColoursOf(field), `${anchor}: its state colours`).toEqual([])
    }

    return anchor
  })
}
