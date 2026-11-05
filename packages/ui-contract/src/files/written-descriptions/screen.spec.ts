import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { screenDescriptions } from './screen'

/** A screen file that writes a description at every place a screen has one, its flow in the shorter forms. */
const SCREEN = `
id: sample
title: Sample
description: Where a member edits the thing.
flag: null
bindings: [ { path: /sample, roles: [ member ], search: { type: object, properties: { tab: { type: string, description: The tab open. }, page: { type: integer } }, additionalProperties: false } } ]
entry: [ sample.page ]
anchors:
  sample.page:
    kind: page
    description: The root.
  sample.title-input:
    kind: input
  sample.save-button:
    kind: button
    binding: { action: thing.updateThing }
states:
  ready: The form with its title.
flow:
  description: The form and its areas.
  initial: editing
  meta:
    guards:
      titleGiven: the title input holds a title
      failedTwice: { codes: [ failed ] }
  states:
    editing:
      description: The form, as typed.
      on:
        sample.save-button:
          - guard: titleGiven
            target: saving
            description: A title saves.
          - description: Without one, nothing runs.
        sample.page: saving
        sample.title-input: {}
    saving:
      invoke:
        src: thing.updateThing
        onDone: { target: editing, description: Saved. }
        onError: editing
    viewing:
      type: parallel
      description: The areas side by side.
      states:
        title:
          pattern: draft
          description: The title follows the stored one.
          input: sample.title-input
          stored: model.thing.title
          guard: titleGiven
        save:
          by: sample.save-button
          description: The save on its own.
          onError:
            - guard: failedTwice
              description: Twice failed.
            - editing
        list:
          initial: idle
          states:
            idle:
              description: Nothing runs.
              on:
                sample.page: { target: idle, description: The page again. }
`

describe('screenDescriptions', () => {
  it('reads every description the screen file writes, each by its place', () => {
    expect(screenDescriptions(parse(SCREEN))).toEqual([
      {
        at: ['description'],
        kind: 'screen',
        place: 'sample',
        text: 'Where a member edits the thing.',
      },
      {
        at: ['bindings', 0, 'search', 'properties', 'tab', 'description'],
        kind: 'parameter',
        place: 'sample binding /sample search tab',
        text: 'The tab open.',
      },
      {
        at: ['anchors', 'sample.page', 'description'],
        kind: 'anchor',
        place: 'sample.page',
        text: 'The root.',
      },
      {
        at: ['states', 'ready'],
        kind: 'containerState',
        place: 'sample state ready',
        text: 'The form with its title.',
      },
      {
        at: ['flow', 'description'],
        kind: 'flow',
        place: 'sample flow',
        text: 'The form and its areas.',
      },
      {
        at: ['flow', 'meta', 'guards', 'titleGiven'],
        kind: 'guard',
        place: 'sample guard titleGiven',
        text: 'the title input holds a title',
      },
      {
        at: ['flow', 'states', 'editing', 'description'],
        kind: 'state',
        place: 'sample flow editing',
        text: 'The form, as typed.',
      },
      {
        at: ['flow', 'states', 'editing', 'on', 'sample.save-button', 0, 'description'],
        kind: 'transition',
        place: 'sample flow editing on sample.save-button #1',
        text: 'A title saves.',
      },
      {
        at: ['flow', 'states', 'editing', 'on', 'sample.save-button', 1, 'description'],
        kind: 'transition',
        place: 'sample flow editing on sample.save-button #2',
        text: 'Without one, nothing runs.',
      },
      {
        at: ['flow', 'states', 'saving', 'invoke', 'onDone', 'description'],
        kind: 'transition',
        place: 'sample flow saving onDone',
        text: 'Saved.',
      },
      {
        at: ['flow', 'states', 'viewing', 'description'],
        kind: 'state',
        place: 'sample flow viewing',
        text: 'The areas side by side.',
      },
      {
        at: ['flow', 'states', 'viewing', 'states', 'title', 'description'],
        kind: 'region',
        place: 'sample flow viewing.title',
        text: 'The title follows the stored one.',
      },
      {
        at: ['flow', 'states', 'viewing', 'states', 'save', 'description'],
        kind: 'region',
        place: 'sample flow viewing.save',
        text: 'The save on its own.',
      },
      {
        at: ['flow', 'states', 'viewing', 'states', 'save', 'onError', 0, 'description'],
        kind: 'transition',
        place: 'sample flow viewing.save onError #1',
        text: 'Twice failed.',
      },
      {
        at: ['flow', 'states', 'viewing', 'states', 'list', 'states', 'idle', 'description'],
        kind: 'state',
        place: 'sample flow viewing.list.idle',
        text: 'Nothing runs.',
      },
      {
        at: [
          'flow',
          'states',
          'viewing',
          'states',
          'list',
          'states',
          'idle',
          'on',
          'sample.page',
          'description',
        ],
        kind: 'transition',
        place: 'sample flow viewing.list.idle on sample.page',
        text: 'The page again.',
      },
    ])
  })
  it('reads none where the file writes none: the loader derives those, and they are not written', () => {
    expect(
      screenDescriptions(
        parse(`
id: bare
title: Bare
description: A screen with nothing else described.
bindings: [ { path: /bare, roles: [ member ] } ]
entry: [ bare.page ]
anchors:
  bare.page: { kind: page }
  bare.heading: { kind: heading }
flow:
  initial: idle
  states:
    idle:
      on: { bare.page: idle }
`),
      ),
    ).toEqual([
      {
        at: ['description'],
        kind: 'screen',
        place: 'bare',
        text: 'A screen with nothing else described.',
      },
    ])
  })
  it('refuses a screen file without its id, which names every place', () => {
    expect(() => screenDescriptions({ description: 'No id.' })).toThrow('a screen file names no id')
  })
})
