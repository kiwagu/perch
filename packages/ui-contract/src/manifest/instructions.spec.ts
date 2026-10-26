import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'

import { instructionsOf } from './instructions'
import { contractAt } from './manifest.fixture'

/** The contract of the fixture repository, read from a temporary root removed afterwards. */
function fixtureRepositoryContract() {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-instructions-'))

  try {
    writeContractRepository(root)

    return contractAt(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('instructionsOf', () => {
  const { vocabulary, screens } = fixtureRepositoryContract()
  const instructions = instructionsOf(vocabulary, screens.platform, 'ready')

  it('says what to wait for with the status anchor and the states of the vocabulary', () => {
    expect(instructions.readiness).toContain(
      '`[data-testid="app-shell.status"][data-state="ready"]`',
    )
    expect(instructions.readiness).toContain('Its other states (`opening`)')
    expect(instructions.readiness).toContain('one of `loading`')
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
  it('says what a data event is, that a button follows the states that handle it, and what fields are', () => {
    expect(instructions.screenMap).toContain(
      'a data event `model.<entity>.<field>`: the stored value of a field the screen shows changed, here or on another device',
    )
    expect(instructions.screenMap).toContain(
      'A control whose anchor is an event of the flow (a button, a select, a switch) is enabled exactly while a state the machine is in handles that event',
    )
    expect(instructions.screenMap).toContain(
      "`fields` (an error's codes, each with the field it concerns, which the error shows under and marks invalid)",
    )
  })
  it("says a flow's state may be a parallel state of regions, each event in one area", () => {
    expect(instructions.screenMap).toContain('`type: parallel`')
    expect(instructions.screenMap).toContain('its `states` are regions')
    expect(instructions.screenMap).toContain('`<parallel>.<region>.<state>`')
    expect(instructions.screenMap).toContain(
      "an event is handled by one region or by the state's own `on`, never by two",
    )
    expect(instructions.screenMap).toContain('`#<flow id>.<state>`')
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
  it('says a gap of the contract is signalled with four lines, never emulated', () => {
    expect(instructions.gaps).toContain('`Contract gap:`')
    expect(instructions.gaps).toContain('`Facet:`')
    expect(instructions.gaps).toContain('`Emulation refused:`')
    expect(instructions.gaps).toContain('`Proposal:`')
    expect(instructions.gaps).toContain('Never hold it in the app or in a test instead')
  })
  it('writes every instruction', () => {
    for (const text of Object.values(instructions)) {
      expect(text.length).toBeGreaterThan(80)
    }
  })
})
