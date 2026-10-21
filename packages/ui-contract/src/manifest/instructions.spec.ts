import { describe, expect, it } from 'vitest'

import { instructionsOf } from './instructions'
import { contractAt, REPOSITORY_ROOT } from './manifest.fixture'

describe('instructionsOf', () => {
  const { vocabulary, screens } = contractAt(REPOSITORY_ROOT)
  const instructions = instructionsOf(vocabulary, screens.platform, 'ready')

  it('says what to wait for with the status anchor and the states of the vocabulary', () => {
    expect(instructions.readiness).toContain(
      '`[data-testid="app-shell.status"][data-state="ready"]`',
    )
    expect(instructions.readiness).toContain('`opening`, `failed`, `storage-blocked`')
    expect(instructions.readiness).toContain('`loading`, `ready`, `empty`, `error`')
  })
  it("names the shell's notice from the reserved anchors", () => {
    expect(instructions.notices).toContain('(`app-shell.notice-message`)')
  })
  it('names the page helper and the platform actions that make an account', () => {
    expect(instructions.screenMap).toContain('`window.__perch.ui.anchors()`')
    expect(instructions.session).toContain('`platform.sign-up`')
  })
  it('writes every instruction', () => {
    for (const text of Object.values(instructions)) {
      expect(text.length).toBeGreaterThan(80)
    }
  })
})
