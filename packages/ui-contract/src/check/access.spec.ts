import { describe, expect, it } from 'vitest'

import { type AnchorDef, type Binding, formatProblem } from '../files'

import { accessProblems } from './access'
import type { Contract } from './contract'
import { anchorIn, sampleContract, screenIn } from './contract.fixture'

const printed = (contract: Contract): string[] => accessProblems(contract).map(formatProblem)

const SAMPLE = 'contract/domain/screens/sample/$key.yaml:1:'
const FRAME = 'contract/domain/screens/__root.yaml:1:'
const NOT_FOUND = 'contract/domain/screens/$.yaml:1:'
const CONSOLE = 'contract/domain/screens/console.yaml:1:'

/** A screen of one binding and the anchors given, appended to `contract` with its file. */
function addScreen(
  contract: Contract,
  file: string,
  id: string,
  binding: Binding,
  anchors: Record<string, AnchorDef> = {},
): void {
  contract.screens.screens.push({
    id,
    title: id,
    description: `The ${id} screen.`,
    bindings: [binding],
    flag: null,
    entry: [],
    anchors,
  })
  contract.screens.files = [...contract.screens.files, file]
}

/** The sample with the not-found screen at `/$`, serving every account, and the role operator. */
function sample(notFound: readonly string[] = ['guest', 'identity']): Contract {
  const contract = sampleContract()

  Object.assign(contract.vocabulary.roles, { identity: 'signed in', operator: 'operates' })
  addScreen(contract, 'contract/domain/screens/$.yaml', 'not-found', {
    path: '/$',
    roles: [...notFound],
    history: 'push',
  })

  return contract
}

/** The sample with a console only an operator opens, at `/console`. */
function withConsole(): Contract {
  const contract = sample()

  addScreen(contract, 'contract/domain/screens/console.yaml', 'console', {
    path: '/console',
    roles: ['operator'],
    history: 'push',
  })

  return contract
}

describe('accessProblems', () => {
  it('finds nothing in the sample with a not-found screen that serves every account', () => {
    expect(printed(sample())).toEqual([])
    expect(printed(withConsole())).toEqual([])
  })

  it('wants the binding at /$ to serve every account: guest and identity', () => {
    expect(printed(sample(['guest', 'member']))).toEqual([
      `${NOT_FOUND} bindings[0].roles: the binding at "/$" opens the not-found screen for every account: its roles name guest and identity`,
    ])
    expect(printed(sampleContract())).toEqual([
      `${FRAME} (root): no screen has a binding at "/$": an account a binding's roles miss gets that screen`,
    ])
  })

  it('refuses a guard that sends away an account its roles name', () => {
    const contract = sample()
    const [binding] = screenIn(contract, 'sample').bindings

    Object.assign(binding ?? {}, { guard: 'authenticated', roles: ['guest', 'member'] })
    addScreen(contract, 'contract/domain/screens/console.yaml', 'console', {
      path: '/console',
      guard: 'guest',
      roles: ['guest', 'identity', 'operator'],
      history: 'push',
    })

    expect(printed(contract)).toEqual([
      `${SAMPLE} bindings[0].guard: "authenticated" sends a guest to sign in, but its roles name guest: leave guest out of the roles, or the guard out`,
      `${CONSOLE} bindings[0].guard: "guest" sends a signed-in account to the profile, but its roles name identity, operator: a route for guests alone names guest alone`,
    ])
  })

  it("wants an anchor's roles among those of its screen's bindings, the frame aside", () => {
    const contract = sample()

    anchorIn(contract, 'sample.save-button').roles = ['member', 'operator']
    Object.assign(screenIn(contract, 'app-shell').anchors['app-shell.status'] ?? {}, {
      roles: ['operator'],
    })

    expect(printed(contract)).toEqual([
      `${SAMPLE} anchors["sample.save-button"].roles[1]: "operator" is a role of no binding of the screen (member)`,
    ])
  })

  it('shows a link to a route some roles alone open only to those roles', () => {
    const contract = withConsole()
    const link = (roles?: string[]): AnchorDef => ({
      kind: 'link',
      binding: { route: '/console' },
      ...(roles === undefined ? {} : { roles }),
    })

    Object.assign(screenIn(contract, 'app-shell').anchors, {
      'app-shell.bare-link': link(),
      'app-shell.mixed-link': link(['identity', 'operator']),
      'app-shell.console-link': link(['operator']),
      'app-shell.nav': { kind: 'nav', roles: ['identity'] },
      'app-shell.nav.console-link': link(),
    })
    Object.assign(screenIn(contract, 'sample').anchors, { 'sample.console-link': link() })

    expect(printed(contract)).toEqual([
      `${FRAME} anchors["app-shell.bare-link"]: a link to /console, which serves operator alone, names who sees it: roles`,
      `${FRAME} anchors["app-shell.mixed-link"].roles[0]: "identity" is shown a link to /console, which serves operator alone`,
      `${FRAME} anchors["app-shell.nav.console-link"].binding.route: "identity" is shown a link to /console, which serves operator alone`,
      `${SAMPLE} anchors["sample.console-link"].binding.route: "member" is shown a link to /console, which serves operator alone`,
    ])
  })
})
