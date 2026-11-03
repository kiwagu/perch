import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { kindOf } from '../anchors'
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
    const others = Object.keys(vocabulary.appStates).filter((state) => state !== 'ready')

    expect(others.length).toBeGreaterThan(0)
    expect(instructions.readiness).toContain(
      `\`[data-testid="${screens.platform.status.anchor}"][data-state="ready"]\``,
    )

    for (const state of [...others, ...Object.keys(vocabulary.containerStates)]) {
      expect(instructions.readiness).toContain(`\`${state}\``)
    }
  })
  it("names the shell's notice from the reserved anchors", () => {
    const messages = screens.platform.reserved.filter((anchor) => kindOf(anchor) === 'message')

    expect(messages.length).toBeGreaterThan(0)

    for (const anchor of messages) {
      expect(instructions.notices).toContain(`\`${anchor}\``)
    }
  })
  it('names the page helper, and sends what a platform action does to the platform file', () => {
    expect(instructions.screenMap).toContain('`window.__perch.ui.anchors()`')
    expect(instructions.session).toContain(
      'What a platform action does is read from `platform.actions.<name>`',
    )
    expect(instructions.session).toContain("never assume it from the action's name")
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
  it("says a password input's visibility-button is presentation only, held by the input itself", () => {
    expect(instructions.screenMap).toContain('`<input>.visibility-button`')
    expect(instructions.screenMap).toContain('never an event of a flow and always enabled')
    expect(instructions.screenMap).toContain('`contract.derivedParts`')
    expect(instructions.gaps).toContain('whether a password input shows what it holds')
  })
  it('says a navigate may carry into a search what a field of the screen holds', () => {
    expect(instructions.screenMap).toContain('`{ "anchor": "<field>" }`')
  })
  it('says what a clear does to a field and to an anchor that carries codes', () => {
    expect(instructions.screenMap).toContain(
      '`clear` empties a field of the screen, a secret one included, so it holds no input any more, as if nothing was typed',
    )
    expect(instructions.screenMap).toContain(
      'and makes an anchor that carries codes show none until one is shown again',
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
  it("says which anchors a flow's state renders: those no state lists in every state", () => {
    expect(instructions.screenMap).toContain(
      "A state's `meta.renders` names anchors of the screen that only some states render: an anchor no state of the flow lists is rendered in every state, one that a state lists is rendered only in the states that list it, a state of a region rendering what its parallel state lists too.",
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
  it('says a gap of the contract is signalled with four lines, never emulated', () => {
    expect(instructions.gaps).toContain('`Contract gap:`')
    expect(instructions.gaps).toContain('`Facet:`')
    expect(instructions.gaps).toContain('`Emulation refused:`')
    expect(instructions.gaps).toContain('`Proposal:`')
    expect(instructions.gaps).toContain('Never hold it in the app or in a test instead')
  })
  it('says what a composite opt-in is and how the anchors it derives are marked', () => {
    expect(instructions.screenMap).toContain(
      '`composite` on a secret input names the platform composite it opts into (`platform.composites.<name>`)',
    )
    expect(instructions.screenMap).toContain(
      'each marked `derivedFrom` with the composite and, for an item, its name',
    )
  })
  it("says a button's params derive from its fields, and an error's codes and outcome from its flow", () => {
    expect(instructions.bindings).toContain(
      "A button's action `params` are the union of the params the fields of its part pass for that action, a param the screen writes on the button winning",
    )
    expect(instructions.bindings).toContain(
      'the failures of the actions bound beside it and invoked against it by the flow, plus the codes the flow shows on it, `failed` last',
    )
    expect(instructions.bindings).toContain(
      "an invoke without `onError` whose action fails with codes clears its part's error on entry and, back in the one state that entered it on a control, shows the failure there",
    )
    expect(instructions.bindings).toContain(
      'a start state, one several states enter, or one a platform or data event enters, writes its `onError`',
    )
    expect(instructions.bindings).toContain(
      "an `onError` written as its target alone still shows the failure on that error, on the screen's error when no control enters and the input names no field",
    )
  })
  it('writes every instruction', () => {
    for (const text of Object.values(instructions)) {
      expect(text.length).toBeGreaterThan(80)
    }
  })
})
