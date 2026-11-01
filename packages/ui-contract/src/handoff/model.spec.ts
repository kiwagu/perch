import { describe, expect, it } from 'vitest'

import { anchorIn, sampleContract, screenIn } from '../check/contract.fixture'

import { modelCoverage } from './model'

describe('modelCoverage', () => {
  it('lists every field and action of each entity with the anchors bound to it', () => {
    expect(modelCoverage(sampleContract())).toEqual([
      {
        entity: 'thing',
        fields: [
          { name: 'id', anchors: [] },
          { name: 'title', anchors: ['sample.title-input'] },
          { name: 'created_at', anchors: [] },
        ],
        actions: [
          { name: 'createThing', anchors: ['sample.save-button'] },
          { name: 'updateThing', anchors: ['sample.save-button'] },
        ],
      },
    ])
  })
  it('takes the anchors of every screen, in their order, each one once', () => {
    const contract = sampleContract()

    screenIn(contract, 'app-shell').anchors['app-shell.title-input'] = {
      kind: 'input',
      binding: [{ model: 'thing.title' }, { model: 'thing.title' }],
    }
    anchorIn(contract, 'sample.page').binding = { model: 'thing.created_at' }

    const [thing] = modelCoverage(contract)

    expect(thing?.fields).toEqual([
      { name: 'id', anchors: [] },
      { name: 'title', anchors: ['app-shell.title-input', 'sample.title-input'] },
      { name: 'created_at', anchors: ['sample.page'] },
    ])
  })
  it('binds nothing of the model through a route or a platform action', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.save-button').binding = { route: '/sample/$key' }

    expect(modelCoverage(contract)[0]?.actions).toEqual([
      { name: 'createThing', anchors: [] },
      { name: 'updateThing', anchors: [] },
    ])
  })
})
