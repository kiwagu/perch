import { describe, expect, it } from 'vitest'

import { screensOf, writtenBy } from '../documents.fixture'

import { dropLinkRoles } from './link-roles'

/**
 * The frame, the panel and options pages (signed in, member or admin) and the sign-in (guest):
 * the frame serves every role, a page only the roles of its own bindings.
 */
const TEXTS = {
  '__root.yaml': `id: app-shell
title: The frame
frame: true
bindings: []
anchors:
  app-shell.nav.panel-link:
    kind: link
    description: Leads to the panel.
    binding: { route: /panel }
    roles: [ identity, member, admin ]
  app-shell.nav.identity-link:
    kind: link
    binding: { route: /panel }
    roles: [ identity ] # the signed-in
  app-shell.nav.sign-in-link:
    kind: link
    binding: { route: /sign-in }
    roles: [ guest ]
  app-shell.nav.admin-link:
    kind: link
    binding: { route: /panel }
    roles: [ admin ]
  app-shell.nav.plain-link:
    kind: link
    binding: { route: /panel }
  app-shell.nav.lost-link:
    kind: link
    binding: { route: /nowhere }
    roles: [ identity ]
  app-shell.nav.several-link:
    kind: link
    binding:
      - route: /panel
      - route: /sign-in
    roles: [ identity ]
  app-shell.nav.button:
    kind: button
    binding: { action: platform.sign-out }
    roles: [ identity ]
`,
  'panel.yaml': `id: sample.panel
title: The panel
bindings: [ { path: /panel, roles: [ identity, member, admin ] } ]
anchors:
  sample.panel.options-link:
    kind: link
    binding: { route: /options }
    roles: [ identity, member, admin ]
`,
  'options.yaml': `id: sample.options
title: Options
bindings: [ { path: /options, roles: [ identity, member, admin ] } ]
anchors:
  sample.options.panel-link:
    kind: link
    binding: { route: /panel }
    roles: [ identity ]
`,
  'sign-in.yaml': `id: sample.sign-in
title: Sign in
bindings: [ { path: /sign-in, roles: [ guest ] } ]
anchors:
  sample.sign-in.panel-link:
    kind: link
    binding: { route: /panel }
    roles: [ identity ]
`,
}

/** Runs the part over `TEXTS` and returns the text each file writes. */
function written(texts: Readonly<Record<string, string>>): Record<string, string> {
  const screens = screensOf(texts)

  dropLinkRoles(screens)

  return writtenBy(texts, screens)
}

describe('dropLinkRoles', () => {
  it('drops the roles of a link that admit what its route admits, where that is fewer devices than its screen serves', () => {
    expect(written(TEXTS)['__root.yaml']).toBe(`id: app-shell
title: The frame
frame: true
bindings: []
anchors:
  app-shell.nav.panel-link:
    kind: link
    description: Leads to the panel.
    binding: { route: /panel }
  app-shell.nav.identity-link:
    kind: link
    binding: { route: /panel }
  app-shell.nav.sign-in-link:
    kind: link
    binding: { route: /sign-in }
  app-shell.nav.admin-link:
    kind: link
    binding: { route: /panel }
    roles: [ admin ]
  app-shell.nav.plain-link:
    kind: link
    binding: { route: /panel }
  app-shell.nav.lost-link:
    kind: link
    binding: { route: /nowhere }
    roles: [ identity ]
  app-shell.nav.several-link:
    kind: link
    binding:
      - route: /panel
      - route: /sign-in
    roles: [ identity ]
  app-shell.nav.button:
    kind: button
    binding: { action: platform.sign-out }
    roles: [ identity ]
`)
  })
  it('leaves the roles of a link whose route admits every device its screen serves, equal or not', () => {
    const result = written(TEXTS)

    expect(result['panel.yaml']).toBe(TEXTS['panel.yaml'])
    expect(result['options.yaml']).toBe(TEXTS['options.yaml'])
  })
  it('drops them from a screen that serves more than its route does, in another file', () => {
    expect(written(TEXTS)['sign-in.yaml']).toBe(
      TEXTS['sign-in.yaml'].replace('    roles: [ identity ]\n', ''),
    )
  })
  it('finds nothing to do in what it wrote', () => {
    const first = written(TEXTS)

    expect(written(first)).toEqual(first)
  })
})
