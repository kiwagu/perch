import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { activityDescriptions } from './activity'

const ACTIVITY = `
id: thing
title: Edit the thing
description: A member saves the title of the thing.
roles: [ member ]
data:
  thing:
    description: The thing being edited.
  thing.title:
    model: thing.title
    description: Its title.
initial: editing
meta:
  guards:
    titleGiven: the title input holds a title
states:
  editing:
    description: The thing in its form.
    meta: { screen: sample, address: { path: /sample } }
    on:
      sample.save-button:
        - target: saved
          guard: titleGiven
          description: The title is saved.
        - target: editing
      sample.home-link:
        target: done
  saved:
    meta: { screen: sample, address: { path: /sample } }
    on:
      sample.home-link: { target: done, description: Back home. }
  done:
    type: final
    meta: { screen: sample, address: { path: /sample } }
`

describe('activityDescriptions', () => {
  it('reads the descriptions of the activity, its data, its guards, its visits and their transitions', () => {
    expect(activityDescriptions(parse(ACTIVITY))).toEqual([
      {
        at: ['description'],
        kind: 'activity',
        place: 'activity thing',
        text: 'A member saves the title of the thing.',
      },
      {
        at: ['data', 'thing', 'description'],
        kind: 'activityData',
        place: 'activity thing data thing',
        text: 'The thing being edited.',
      },
      {
        at: ['data', 'thing.title', 'description'],
        kind: 'activityData',
        place: 'activity thing data thing.title',
        text: 'Its title.',
      },
      {
        at: ['meta', 'guards', 'titleGiven'],
        kind: 'guard',
        place: 'activity thing guard titleGiven',
        text: 'the title input holds a title',
      },
      {
        at: ['states', 'editing', 'description'],
        kind: 'visit',
        place: 'activity thing state editing',
        text: 'The thing in its form.',
      },
      {
        at: ['states', 'editing', 'on', 'sample.save-button', 0, 'description'],
        kind: 'activityTransition',
        place: 'activity thing state editing on sample.save-button #1',
        text: 'The title is saved.',
      },
      {
        at: ['states', 'saved', 'on', 'sample.home-link', 'description'],
        kind: 'activityTransition',
        place: 'activity thing state saved on sample.home-link',
        text: 'Back home.',
      },
    ])
  })
  it('refuses an activity file without its id, which names every place', () => {
    expect(() => activityDescriptions({ description: 'No id.' })).toThrow(
      'an activity file names no id',
    )
  })
})
