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
  it('says a binding is a route of the router and a route a state address', () => {
    expect(instructions.screenMap).toContain('a TanStack Router path')
    expect(instructions.screenMap).toContain(
      'a route is a state address: the same path with the same search reaches the same state after a reload',
    )
  })
  it("says what a binding's example link is and that the app's own links are shorter", () => {
    expect(instructions.screenMap).toContain('`example`')
    expect(instructions.screenMap).toContain('leave out a value equal to its default')
  })
  it('says a flow is an XState machine config, carried into the app unchanged', () => {
    expect(instructions.screenMap).toContain("A screen's `flow` is an XState v5 machine config")
    expect(instructions.screenMap).toContain(
      'Carry it into `setup({ guards, actions, actors }).createMachine(flow)` unchanged',
    )
  })
  it("says a flow's state may be a parallel state of regions, each event in one area", () => {
    expect(instructions.screenMap).toContain('`type: parallel`')
    expect(instructions.screenMap).toContain('its `states` are regions')
    expect(instructions.screenMap).toContain('`<parallel>.<region>.<state>`')
    expect(instructions.screenMap).toContain(
      "an event is handled by one region or by the state's own `on`, never by two",
    )
  })
  it('says an activity is a machine of visits to screens, which the flows of the screens do', () => {
    expect(instructions.activities).toContain('a state is a visit to a screen')
    expect(instructions.activities).toContain('`meta.screen`')
    expect(instructions.activities).toContain('`meta.address`')
    expect(instructions.activities).toContain('the screens do the work')
    expect(instructions.activities).toContain('createMachine(activity)` unchanged')
  })
  it('names the activity a scenario may walk among the fields of a scenario', () => {
    expect(instructions.scenarios).toContain('`activity`')
  })
  it('writes every instruction', () => {
    for (const text of Object.values(instructions)) {
      expect(text.length).toBeGreaterThan(80)
    }
  })
})
