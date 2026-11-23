import { describe, expect, it } from 'vitest'

import {
  MODEL_FILE,
  PLATFORM_FILE,
  TERMS_FILE,
  type Terms,
  VOCABULARY_FILE,
  type WrittenDescription,
} from '../files'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { contractProblems } from './run'
import { synonymsProblems } from './synonyms'

const SCREEN_FILE = 'contract/domain/screens/sample/$key.yaml'

const TERMS: Terms = {
  contexts: { sample: { meaning: 'The sample platform.' } },
  terms: {
    organisation: { meaning: 'Accounts that work together.', synonyms: ['tenant', 'org'] },
    session: { meaning: 'One sign-in of a device.', synonyms: ['device session'] },
  },
  roles: {
    guest: { meaning: 'Nobody is signed in.' },
    member: { meaning: 'A member of the organisation.', synonyms: ['participant'] },
  },
}

/** The sample with `terms` and the descriptions `texts` of its screen file. */
function withTerms(terms: Terms | undefined, texts: readonly string[] = []): Contract {
  const contract = sampleContract()
  const descriptions = texts.map(
    (text, index): WrittenDescription => ({
      file: SCREEN_FILE,
      line: index + 4,
      at: ['anchors', `sample.item-${index}`, 'description'],
      kind: 'anchor',
      place: `sample.item-${index}`,
      text,
    }),
  )

  return { ...contract, terms, termsLines: {}, descriptions }
}

const said = (index: number, written: string, synonym: string, of: string) => ({
  file: SCREEN_FILE,
  line: index + 4,
  message: `anchors["sample.item-${index}"].description: the description of sample.item-${index} says "${written}", a synonym of ${of}; write "${synonym}"`,
})

describe('synonymsProblems', () => {
  it('runs in the contract check', () => {
    expect(contractProblems(withTerms(TERMS, ['The tenant of the thing.']))).toContainEqual(
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    )
  })
  it('passes a contract without a terms file, and texts that use the terms', () => {
    expect(synonymsProblems(withTerms(undefined, ['The tenant of the thing.']))).toEqual([])
    expect(
      synonymsProblems(withTerms(TERMS, ['The organisation of the thing, for a member.'])),
    ).toEqual([])
  })
  it('refuses a synonym in a written description, at its line, naming the term to write', () => {
    expect(synonymsProblems(withTerms(TERMS, ['The tenant of the thing.']))).toEqual([
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    ])
  })
  it('reads whole words in any case, with a plural or a possessive, never a part of a word', () => {
    expect(
      synonymsProblems(
        withTerms(TERMS, [
          'Tenants share it.',
          "The tenant's key.",
          'Its tenancy and its organisations.',
          'The ORG.',
        ]),
      ),
    ).toEqual([
      said(0, 'Tenants', 'organisation', 'the term "organisation"'),
      said(1, 'tenant', 'organisation', 'the term "organisation"'),
      said(3, 'ORG', 'organisation', 'the term "organisation"'),
    ])
  })
  it("reads a synonym of several words across a space or a dash, and a role's synonym", () => {
    expect(
      synonymsProblems(
        withTerms(TERMS, ['Its device-session id.', 'The device sessions.', 'A participant.']),
      ),
    ).toEqual([
      said(0, 'device-session', 'session', 'the term "session"'),
      said(1, 'device sessions', 'session', 'the term "session"'),
      said(2, 'participant', 'member', 'the role "member"'),
    ])
  })
  it('names each synonym of a text once, at its first place', () => {
    expect(synonymsProblems(withTerms(TERMS, ['A tenant and a tenant.']))).toEqual([
      said(0, 'tenant', 'organisation', 'the term "organisation"'),
    ])
  })
  it("refuses one in an action's outcome lines, its codes' conditions and an invariant's rule", () => {
    const contract = withTerms(TERMS)

    contract.screens.platform.actions = {
      'sign-out': {
        description: 'Signs this device out.',
        params: {},
        result: ['the device session ends'],
        codes: { failed: 'the tenant is gone', gone: { invariant: 'kept' } },
        changes: [],
      },
    }
    contract.screens.platform.invariants = {
      kept: { rule: 'A tenant keeps one member.', refuses: 'gone' },
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `actions["sign-out"].result[0]: the outcome line says "device session", a synonym of the term "session"; write "session"`,
      },
      {
        file: PLATFORM_FILE,
        message: `actions["sign-out"].codes.failed: the condition says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: PLATFORM_FILE,
        message: `invariants.kept.rule: the rule says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in an invariant's name, which the codes' conditions name", () => {
    const contract = withTerms(TERMS)

    contract.screens.platform.invariants = {
      'tenants-only': { rule: 'Only a member of the organisation.', refuses: 'gone' },
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `invariants["tenants-only"]: the invariant's name says "tenants", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in the vocabulary's tables: a row's key or its meaning, a choice value's too", () => {
    const sample = withTerms(TERMS)
    const contract: Contract = {
      ...sample,
      vocabulary: {
        ...sample.vocabulary,
        attributes: { 'data-id': { on: 'a row', meaning: 'the id of a device session' } },
        codes: {
          'tenant-gone': { meaning: 'the organisation is gone', where: 'sample.save-button' },
        },
        choiceValues: { 'sample.mode-select.option': { a: 'a participant', b: 'a guest' } },
      },
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: VOCABULARY_FILE,
        message: `section "Attributes", data-id: the meaning says "device session", a synonym of the term "session"; write "session"`,
      },
      {
        file: VOCABULARY_FILE,
        message: `section "Codes", tenant-gone: the key says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: VOCABULARY_FILE,
        message: `section "Choice values", sample.mode-select.option a: the meaning says "participant", a synonym of the role "member"; write "member"`,
      },
    ])
  })
  it("refuses one in a scenario's prose, read past its bracket references but in its title", () => {
    const sample = withTerms(TERMS)
    const [scenario] = sample.scenarios
    const contract: Contract =
      scenario === undefined
        ? sample
        : {
            ...sample,
            scenarios: [
              {
                ...scenario,
                title: 'A participant edits [the tenant] thing',
                where: "[/sample/$key] on device A (user A, the tenant's member)",
                steps: ['Wait for [app-shell.status] to reach [state:ready]', 'Pick [value:org]'],
              },
            ],
          }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: 'tests/e2e/scenarios/sample/base/thing.md',
        message: `title: the scenario's title says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: 'tests/e2e/scenarios/sample/base/thing.md',
        message: `title: the scenario's title says "participant", a synonym of the role "member"; write "member"`,
      },
      {
        file: 'tests/e2e/scenarios/sample/base/thing.md',
        message: `where: the scenario's text says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in an activity's id, title or state names, and in a model action's name", () => {
    const sample = withTerms(TERMS)
    const [activity] = sample.activities
    const state = activity === undefined ? undefined : Object.values(activity.states)[0]
    const thing = sample.model.entities['thing']
    const contract: Contract =
      activity === undefined || state === undefined || thing === undefined
        ? sample
        : {
            ...sample,
            activities: [
              {
                ...activity,
                title: 'Edit the thing of the tenant',
                states: { ...activity.states, 'org-saved': state },
              },
            ],
            model: {
              ...sample.model,
              entities: {
                ...sample.model.entities,
                thing: {
                  ...thing,
                  actions: { ...thing.actions, deleteTenant: { params: {}, changes: [] } },
                },
              },
            },
          }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: MODEL_FILE,
        message: `$defs.thing["x-perch"].actions.deleteTenant: the model action's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: 'contract/domain/activities/thing.yaml',
        message: `title: the activity's title says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: 'contract/domain/activities/thing.yaml',
        message: `states["org-saved"]: the state's name says "org", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one a model action's confirmation code says beyond its entity and its name", () => {
    const terms: Terms = {
      ...TERMS,
      terms: { ...TERMS.terms, removal: { meaning: 'A removal.', synonyms: ['thing delete'] } },
    }
    const sample = withTerms(terms)
    const thing = sample.model.entities['thing']
    const contract: Contract =
      thing === undefined
        ? sample
        : {
            ...sample,
            model: {
              ...sample.model,
              entities: {
                ...sample.model.entities,
                thing: {
                  ...thing,
                  actions: { ...thing.actions, delete: { params: {}, changes: [] } },
                },
              },
            },
          }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: MODEL_FILE,
        message: `$defs.thing["x-perch"].actions.delete: the confirmation's code thing-delete says "thing-delete", a synonym of the term "removal"; write "removal"`,
      },
    ])
  })
  it("refuses one in an action's name and a screen's id", () => {
    const contract = withTerms(TERMS)
    const sample = contract.screens.screens[1]

    contract.screens.platform.actions = {
      'tenants.list': {
        description: 'Lists them.',
        params: {},
        result: 'them',
        codes: {},
        changes: [],
      },
    }
    if (sample !== undefined) {
      contract.screens.screens[1] = { ...sample, id: 'org' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `actions["tenants.list"]: the action's name says "tenants", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: SCREEN_FILE,
        message: `id: the screen's id says "org", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it('refuses one in what the engine emits: a route path and a role name', () => {
    const contract = withTerms({
      ...TERMS,
      roles: { ...TERMS.roles, 'tenant-admin': { meaning: 'Runs the organisation.' } },
    })
    const sample = contract.screens.screens[1]

    if (sample?.bindings[0] !== undefined) {
      sample.bindings[0] = { ...sample.bindings[0], path: '/org/$key' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `bindings[0].path: the route's path says "org", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: TERMS_FILE,
        message: `roles["tenant-admin"]: the role's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in what CONTRACT_VALUES holds: a value's name or enum, a field's name or enum", () => {
    const contract = withTerms(TERMS)
    const thing = contract.model.entities['thing']

    contract.screens.platform.values = {
      'tenant-key': { type: 'string', maxLength: 32, description: 'A key.' },
      plan: { enum: ['free', 'trial-tenant'], description: 'A plan.' },
    }

    if (thing !== undefined) {
      thing.fields['org'] = { type: 'string', readonly: false, crdt: 'none' }
      thing.fields['kind'] = { enum: ['personal', 'tenant'], readonly: false, crdt: 'none' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: PLATFORM_FILE,
        message: `values["tenant-key"]: the value's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: PLATFORM_FILE,
        message: `values.plan.enum[1]: the value's enum says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: MODEL_FILE,
        message: `$defs.thing.properties.org: the field's name says "org", a synonym of the term "organisation"; write "organisation"`,
      },
      {
        file: MODEL_FILE,
        message: `$defs.thing.properties.kind.enum[1]: the field's enum says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in an anchor's name, which FIELD_FACTS and the code carry", () => {
    const contract = withTerms(TERMS)
    const sample = contract.screens.screens[1]

    if (sample !== undefined) {
      sample.anchors['sample.tenant-input'] = { kind: 'input' }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `anchors["sample.tenant-input"]: the anchor's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one in an entity's name, which every key of its fields carries, once", () => {
    const contract = withTerms(TERMS)
    const thing = contract.model.entities['thing']

    if (thing !== undefined) {
      contract.model.entities = { 'tenant-thing': { ...thing, name: 'tenant-thing' } }
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: MODEL_FILE,
        message: `$defs["tenant-thing"]: the entity's name says "tenant", a synonym of the term "organisation"; write "organisation"`,
      },
    ])
  })
  it("refuses one a derived anchor's name says and its base does not, at the base", () => {
    const contract = withTerms({
      ...TERMS,
      terms: { ...TERMS.terms, option: { meaning: 'A choice.', synonyms: ['select option'] } },
    })

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `anchors["sample.mode-select"]: the derived anchor's name sample.mode-select.option says "select.option", a synonym of the term "option"; write "option"`,
      },
      {
        file: SCREEN_FILE,
        message: `anchors["sample.key-select"]: the derived anchor's name sample.key-select.option says "select.option", a synonym of the term "option"; write "option"`,
      },
    ])
  })
  it("refuses one the key of a further route says across its screen's id and its path", () => {
    const contract = withTerms({
      ...TERMS,
      terms: { ...TERMS.terms, visit: { meaning: 'A visit.', synonyms: ['sample session'] } },
    })
    const sample = contract.screens.screens[1]
    const first = sample?.bindings[0]

    if (sample !== undefined && first !== undefined) {
      sample.bindings = [first, { ...first, path: '/session' }]
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `bindings[1].path: the route's key sample@/session says "sample@/session", a synonym of the term "visit"; write "visit"`,
      },
    ])
  })
  it("refuses one a paged list's size option says beyond its size select", () => {
    const contract = withTerms({
      ...TERMS,
      terms: { ...TERMS.terms, size: { meaning: 'A size.', synonyms: ['size select option'] } },
    })
    const list = contract.screens.screens[1]?.anchors['sample.list']

    if (list !== undefined) {
      list.derived = ['size-select']
    }

    expect(synonymsProblems(contract)).toEqual([
      {
        file: SCREEN_FILE,
        message: `anchors["sample.list"]: the derived anchor's name sample.list.size-select.option says "size-select.option", a synonym of the term "size"; write "size"`,
      },
    ])
  })
})
