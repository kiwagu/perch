import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { writeContractRepository } from '../contract-repository.fixture'
import type { AnchorDef } from '../files'
import { contractAt, fixtureContract } from '../manifest/manifest.fixture'

import { diffContracts } from './diff'
import { formatChanges } from './format-changes'

const NONE = { added: [], removed: [], changed: [] }

const SIGN_OUT = 'sample.sign-out-button'

/** The fixture contract whose sign-out button also says `facets`, and with the anchors `more`. */
function signOut(
  facets: Pick<AnchorDef, 'with' | 'without'>,
  more: Record<string, AnchorDef> = {},
) {
  const contract = fixtureContract()
  const [screen] = contract.screens.screens
  const button = screen?.anchors[SIGN_OUT]

  if (screen === undefined || button === undefined) {
    throw new Error('the fixture has no sign-out button')
  }

  screen.anchors[SIGN_OUT] = { ...button, ...facets }
  Object.assign(screen.anchors, more)

  return contract
}

describe('diffContracts and when an element shows', () => {
  it('lists none for a contract against itself, nor for the same entries written another way round', () => {
    const before = signOut({
      with: ['sample.page', { 'sample.save-button': ['saved', 'failed'] }],
      without: ['sample.title-input'],
    })
    const after = signOut({
      with: [{ 'sample.save-button': ['failed', 'saved'] }, 'sample.page'],
      without: ['sample.title-input'],
    })

    expect(diffContracts(before, before).visibility).toEqual(NONE)
    expect(diffContracts(before, after).visibility).toEqual(NONE)
    expect(formatChanges(diffContracts(before, after))).toBe('contract changes: none')
    expect(before.screens.screens[0]?.anchors[SIGN_OUT]?.with).not.toEqual(
      after.screens.screens[0]?.anchors[SIGN_OUT]?.with,
    )
  })
  it('lists an entry added, and an entry removed, naming the anchor, the list and the entry', () => {
    const before = fixtureContract()
    const after = signOut({ with: ['sample.page'], without: ['sample.title-input'] })

    expect(diffContracts(before, after).visibility).toEqual({
      added: [`${SIGN_OUT} with sample.page`, `${SIGN_OUT} without sample.title-input`],
      removed: [],
      changed: [],
    })
    expect(diffContracts(after, before).visibility).toEqual({
      added: [],
      removed: [`${SIGN_OUT} with sample.page`, `${SIGN_OUT} without sample.title-input`],
      changed: [],
    })
  })
  it('tells an entry of with from the same one of without', () => {
    const before = signOut({ with: ['sample.page'] })
    const after = signOut({ without: ['sample.page'] })

    expect(diffContracts(before, after).visibility).toEqual({
      added: [`${SIGN_OUT} without sample.page`],
      removed: [`${SIGN_OUT} with sample.page`],
      changed: [],
    })
  })
  it('lists a code entry with the codes it names, as a set', () => {
    const before = fixtureContract()
    const after = signOut({ with: [{ 'sample.save-button': ['saved', 'failed'] }] })
    const line = `${SIGN_OUT} with sample.save-button: failed or saved`

    expect(diffContracts(before, after).visibility).toEqual({
      added: [line],
      removed: [],
      changed: [],
    })
    expect(diffContracts(after, before).visibility).toEqual({
      added: [],
      removed: [line],
      changed: [],
    })
  })
  it('lists one line for a code added to, and one for a code removed from, a code entry', () => {
    const one = signOut({ with: [{ 'sample.save-button': ['saved'] }] })
    const both = signOut({ with: [{ 'sample.save-button': ['saved', 'failed'] }] })

    expect(diffContracts(one, both).visibility).toEqual({
      added: [],
      removed: [],
      changed: [`${SIGN_OUT} with sample.save-button codes saved -> failed or saved`],
    })
    expect(diffContracts(both, one).visibility.changed).toEqual([
      `${SIGN_OUT} with sample.save-button codes failed or saved -> saved`,
    ])
  })
  it('lists an anchor entry that comes to name codes, and a code entry that stops naming them', () => {
    const plain = signOut({ with: ['sample.save-button'] })
    const coded = signOut({ with: [{ 'sample.save-button': ['saved'] }] })

    expect(diffContracts(plain, coded).visibility).toEqual({
      added: [],
      removed: [],
      changed: [`${SIGN_OUT} with sample.save-button codes none -> saved`],
    })
    expect(diffContracts(coded, plain).visibility.changed).toEqual([
      `${SIGN_OUT} with sample.save-button codes saved -> none`,
    ])
  })
  it('lists an entry of an element in a list entry, once, by the anchors it names', () => {
    const ended: Record<string, AnchorDef> = {
      'sample.list.current-badge': { kind: 'badge' },
      'sample.list.end-button': { kind: 'button', without: ['sample.list.current-badge'] },
    }
    const before = signOut({}, { ...ended, 'sample.list.end-button': { kind: 'button' } })
    const after = signOut({}, ended)

    expect(diffContracts(before, after).visibility).toEqual({
      added: ['sample.list.end-button without sample.list.current-badge'],
      removed: [],
      changed: [],
    })
  })
  it('lists every entry of an anchor added or removed whole, which nothing else says', () => {
    const before = fixtureContract()
    const after = signOut(
      {},
      {
        'sample.notice': { kind: 'message', codes: ['saved'] },
        'sample.retry-button': {
          kind: 'button',
          with: [{ 'sample.notice': ['saved'] }],
          without: ['sample.page'],
        },
      },
    )
    const lines = [
      'sample.retry-button with sample.notice: saved',
      'sample.retry-button without sample.page',
    ]

    expect(diffContracts(before, after).visibility).toEqual({
      added: lines,
      removed: [],
      changed: [],
    })
    expect(diffContracts(after, before).visibility).toEqual({
      added: [],
      removed: lines,
      changed: [],
    })
  })
  it('lists nothing for an anchor renamed, nor for an entry that names an anchor renamed', () => {
    const marks = (badge: string, button: string): Contract =>
      signOut(
        {},
        {
          [badge]: { kind: 'badge', without: ['sample.page'] },
          [button]: { kind: 'button', with: [badge] },
        },
      )
    const before = marks('sample.mark-badge', 'sample.mark-button')

    expect(diffContracts(before, marks('sample.flag-badge', 'sample.mark-button'))).toMatchObject({
      anchors: { renamed: [{ from: 'sample.mark-badge', to: 'sample.flag-badge' }] },
      visibility: NONE,
    })
    expect(diffContracts(before, marks('sample.mark-badge', 'sample.flag-button'))).toMatchObject({
      anchors: { renamed: [{ from: 'sample.mark-button', to: 'sample.flag-button' }] },
      visibility: NONE,
    })
  })
  it('prints the entries added, removed and changed', () => {
    const before = signOut({
      with: [{ 'sample.save-button': ['saved'] }],
      without: ['sample.title-input'],
    })
    const after = signOut({
      with: [{ 'sample.save-button': ['saved', 'failed'] }],
      without: ['sample.page'],
    })

    expect(formatChanges(diffContracts(before, after)).split('\n')).toEqual([
      'contract changes: 1 visibility entry added, 1 visibility entry removed, 1 visibility entry changed',
      `visibility entries added: ${SIGN_OUT} without sample.page`,
      `visibility entries removed: ${SIGN_OUT} without sample.title-input`,
      `visibility entries changed: ${SIGN_OUT} with sample.save-button codes saved -> failed or saved`,
    ])
  })
})

describe('diffContracts and the entries a screen file writes', () => {
  const roots: string[] = []

  /** The fixture repository with `entries` written under the sign-out button of its screen file. */
  function repository(entries: string): Contract {
    const root = mkdtempSync(join(tmpdir(), 'ui-contract-visibility-'))
    const file = join(root, 'contract/domain/screens/sample/$key.yaml')

    roots.push(root)
    writeContractRepository(root)
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        '  sample.sign-out-button:\n    kind: button\n',
        `  sample.sign-out-button:\n    kind: button\n${entries}`,
      ),
    )

    return contractAt(root)
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists the entries as the screen file writes them, a code added to one among them', () => {
    const before = repository('    with: [ sample.page, { sample.save-button: [ saved ] } ]\n')
    const after = repository(
      '    with: [ sample.page, { sample.save-button: [ saved, failed ] } ]\n    without: [ sample.title-input ]\n',
    )

    expect(diffContracts(before, before).visibility).toEqual(NONE)
    expect(diffContracts(before, after).visibility).toEqual({
      added: [`${SIGN_OUT} without sample.title-input`],
      removed: [],
      changed: [`${SIGN_OUT} with sample.save-button codes saved -> failed or saved`],
    })
  })
})
