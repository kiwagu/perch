import { describe, expect, it } from 'vitest'

import { type Effect, formatProblem } from '../../files'
import type { Contract } from '../contract'
import { flowIn, flowStateIn, sampleContract, screenIn } from '../contract.fixture'

import { flowProblems } from './problems'

const printed = (contract: Contract): string[] => flowProblems(contract).map(formatProblem)

const AT = 'contract/domain/screens/sample/$key.yaml:1: flow'

/** The sample's entry: an item with a `dataId`, beside the sample's list in the part `sample`. */
const ITEM = 'sample.thing-item'

/** What a control of an entry carries, and what one outside it does not. */
const NOT_ACTED =
  'where no entry was acted on: only the event of a control in its entries carries it'
const OUTSIDE = `which is not in its part "sample": only a control in the item's part, rendered in each entry, carries it`

const navigate = (search: Record<string, unknown>): Effect =>
  ({ type: 'navigate', params: { to: '/sample/$key', search } }) as Effect

/**
 * The sample with a link in the item's part (`sample.open-link`), one in another part
 * (`sample.form.go-link`), and the search keys `id` (a string) and `page` (an integer). The
 * item is an entry of the sample's one list, which follows its things: the list of devices the
 * sample declares beside it in the same part goes, as an invoke that takes an entry of a list
 * with a platform source holds a read of it.
 */
function sample(): Contract {
  const contract = sampleContract()
  const screen = screenIn(contract, 'sample')
  const { 'sample.devices-list': _beside, ...anchors } = screen.anchors

  screen.anchors = {
    ...anchors,
    'sample.open-link': { kind: 'link' },
    'sample.form.go-link': { kind: 'link' },
  }
  Object.assign(screen.bindings[0]?.search?.properties ?? {}, {
    id: { type: 'string' },
    page: { type: 'integer' },
  })

  return contract
}

describe("a navigate's search that takes the data-id of an entry", () => {
  it('takes it on the event of a control in the entry part, into a key that takes a string', () => {
    const contract = sample()

    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.open-link': { actions: [navigate({ id: { item: ITEM }, tab: 'a' })] },
      'sample.a-button': { actions: [navigate({ id: { item: ITEM } })] },
    })

    expect(printed(contract)).toEqual([])
  })

  it('refuses it on an anchor of the entry part that is no control: a cell, a sibling item', () => {
    const contract = sample()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.label-cell': { kind: 'cell' },
      'sample.other-item': { kind: 'item', dataId: 'thing' },
    })
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.label-cell': { actions: [navigate({ id: { item: ITEM } })] },
      'sample.other-item': { actions: [navigate({ id: { item: ITEM } })] },
    })

    const on = `${AT}.states.editing.on`
    const item = 'actions[0].params.search.id.item: takes the data-id of "sample.thing-item"'
    const noControl = 'which is no control: a control in it (a link) carries it'

    expect(printed(contract)).toEqual([
      `${on}["sample.label-cell"].${item} on "sample.label-cell", a cell, ${noControl}`,
      `${on}["sample.other-item"].${item} on "sample.other-item", a item, ${noControl}`,
    ])
  })

  it('wants an item or a row of its own screen, with a dataId, of a list, table or section', () => {
    const contract = sample()

    Object.assign(screenIn(contract, 'sample').anchors, {
      'sample.bare-item': { kind: 'item' },
      'sample.lone.thing-item': { kind: 'item', dataId: 'thing' },
      'sample.lone.open-link': { kind: 'link' },
    })
    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.thing-item': { kind: 'item', dataId: 'thing' },
    })
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.open-link': {
        actions: [
          navigate({ id: { item: 'sample.gone-item' } }),
          navigate({ id: { item: 'app-shell.thing-item' } }),
          navigate({ id: { item: 'sample.list' } }),
          navigate({ id: { item: 'sample.bare-item' } }),
        ],
      },
      'sample.lone.open-link': {
        actions: [navigate({ id: { item: 'sample.lone.thing-item' } })],
      },
    })

    const on = `${AT}.states.editing.on`

    expect(printed(contract)).toEqual([
      `${on}["sample.open-link"].actions[0].params.search.id.item: "sample.gone-item" is not a declared anchor of the screen`,
      `${on}["sample.open-link"].actions[1].params.search.id.item: "app-shell.thing-item" is an anchor of another screen: a search takes the data-id of an entry of its own screen`,
      `${on}["sample.open-link"].actions[2].params.search.id.item: "sample.list" is a list, not an item or a row: a search takes the data-id of an entry`,
      `${on}["sample.open-link"].actions[3].params.search.id.item: "sample.bare-item" declares no dataId: a search takes the data-id of an entry, which its dataId says`,
      `${on}["sample.lone.open-link"].actions[0].params.search.id.item: "sample.lone.thing-item" is an entry of no list, table or section of the screen: an entry is declared under its container or beside it in its part`,
    ])
  })

  it('wants the key it fills to take a string, as a data-id is one', () => {
    const contract = sample()

    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'sample.open-link': { actions: [navigate({ page: { item: ITEM } })] },
    })

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.on["sample.open-link"].actions[0].params.search.page: "page" of "/sample/$key" takes integer: a data-id is a string`,
    ])
  })

  it('refuses it where no entry was acted on: an entry, an exit, an invoke outcome', () => {
    const contract = sample()
    const editing = flowStateIn(contract, 'editing')
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    editing.entry = [navigate({ id: { item: ITEM } })]
    editing.exit = [navigate({ id: { item: ITEM } })]
    Object.assign(invoke.onError ?? {}, { actions: [navigate({ id: { item: ITEM } })] })

    const item = 'params.search.id.item: takes the data-id of "sample.thing-item"'

    expect(printed(contract)).toEqual([
      `${AT}.states.editing.entry[0].${item} in an entry, ${NOT_ACTED}`,
      `${AT}.states.editing.exit[0].${item} in an exit, ${NOT_ACTED}`,
      `${AT}.states.saving.invoke.onError.actions[0].${item} in the onError of thing.updateThing, ${NOT_ACTED}`,
    ])
  })

  it('refuses it on an event that is no control of the entry part, and on the entry itself', () => {
    const contract = sample()

    contract.screens.platform.events = { opened: 'the local data is open' }
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'platform.opened': { actions: [navigate({ id: { item: ITEM } })] },
      'app-shell.status': { actions: [navigate({ id: { item: ITEM } })] },
      [ITEM]: { actions: [navigate({ id: { item: ITEM } })] },
      'sample.form.go-link': { actions: [navigate({ id: { item: ITEM } })] },
    })

    const on = `${AT}.states.editing.on`
    const item = 'actions[0].params.search.id.item: takes the data-id of "sample.thing-item"'
    const noControl =
      'which is no control of the screen: only the event of a control in its entries carries it'

    expect(printed(contract)).toEqual([
      `${on}["platform.opened"].${item} on "platform.opened", ${noControl}`,
      `${on}["app-shell.status"].${item} on "app-shell.status", ${noControl}`,
      `${on}["sample.thing-item"].${item} on the entry itself, which is no control: a control in it (a link) carries it`,
      `${on}["sample.form.go-link"].${item} on "sample.form.go-link", ${OUTSIDE}`,
    ])
  })
})

describe("an invoke's input that takes the data-id of an entry", () => {
  it('takes it in a state the events of controls in the entry part enter', () => {
    const contract = sample()
    const invoke = flowStateIn(contract, 'saving').invoke ?? expect.unreachable('an invoke')

    invoke.input = { id: ITEM, title: 'sample.title-input' }

    expect(printed(contract)).toEqual([])
  })

  it('refuses it in a state its area starts in, an outcome enters, or another event enters', () => {
    const contract = sample()
    const flow = flowIn(contract)
    const run = (target: string) => ({
      src: 'thing.updateThing',
      input: { id: ITEM },
      onDone: { target },
    })

    contract.screens.platform.events = { opened: 'the local data is open' }
    flow.initial = 'loading'
    Object.assign(flow.states, {
      loading: { invoke: run('editing') },
      again: { invoke: run('editing') },
      elsewhere: { invoke: run('editing') },
    })
    Object.assign(flowStateIn(contract, 'saving').invoke ?? {}, { onError: { target: 'again' } })
    Object.assign(flowStateIn(contract, 'editing').on ?? {}, {
      'platform.opened': { target: 'elsewhere' },
      'sample.form.go-link': { target: 'elsewhere' },
    })

    const takes = 'invoke.input.id: takes the data-id of "sample.thing-item" in a state'

    expect(printed(contract)).toEqual([
      `${AT}.states.loading.${takes} its area starts in, ${NOT_ACTED}`,
      `${AT}.states.again.${takes} an outcome of "saving" enters, ${NOT_ACTED}`,
      `${AT}.states.elsewhere.${takes} entered on "platform.opened", which is no control of the screen: only the event of a control in its entries carries it`,
      `${AT}.states.elsewhere.${takes} entered on "sample.form.go-link", ${OUTSIDE}`,
    ])
  })
})
