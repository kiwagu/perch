/**
 * The rules of what a state renders: the lists of `meta.renders`, what rendered means, who reads
 * it; a list several states share, named once; when an element shows beside others (`with`,
 * `without`), to some roles only (`roles`) or only on the entries a member owns (`own`); and the
 * two elements that are not rendered by their data, a list with no entries and a cell with no
 * value.
 */

import type { ReferenceRule } from '../rule'

const stateRenders: ReferenceRule = {
  id: 'renders',
  title: 'What a state renders',
  text: [
    "An anchor that only some states render, those states list in `meta.renders`: a plain state of the root, a parallel state or a state of a region. An anchor no state of the flow lists is rendered in every state. An anchor a state lists is rendered only where it is listed: in a plain state of the root that lists it, and in a state of a region that lists it or whose parallel state does. A name is an anchor its screen declares, listed once; a derived part is rendered with its base, so a state lists the base (`user.sign-in.password-input`, never its `visibility-button`). A listed anchor also renders the anchors declared under it (`<anchor>.<rest>`, as a scenario's codes and states speak of them): `user.sign-in.password-rule-list` brings the six items of the composite with it, so a state lists the list alone, never the list and one of its items in one list, and an anchor declared under a listed one is rendered only where its container is, or where a state lists it itself.",
    "A plain state of the root or a state of a region that handles an event on an anchor only some states render renders that anchor (for an event on a derived part or on an anchor declared under another, through the anchor it is under), since a control the user acts on is on the page; a state may render a control it does not handle, which is then disabled. The events of a parallel state's own `on` are not held to this, and neither are the effects: a `show` or a `clear` may name an anchor its state does not render. The states of a region written by its pattern or by its button, or derived by the loader, list nothing: an area that renders something in some of its states only is written in full. For the modes of the sign-in screen (the rest of its flow left out):",
    [
      '```yaml',
      'flow:',
      '  initial: sign-in',
      '  states:',
      '    sign-in:',
      '      meta:',
      '        renders: [ user.sign-in.forgot-link ]',
      '    sign-up:',
      '      meta:',
      '        renders: [ user.sign-in.password-rule-list, user.sign-in.password-confirmation-input, user.sign-in.name-input ]',
      '    check-mail:',
      '      meta:',
      '        renders: [ user.sign-in.forgot-link, user.sign-in.resend-button ]',
      '    # signing-in as sign-in; password-weak, passwords-differ and signing-up as sign-up;',
      '    # unverified and resending as check-mail',
      '```',
    ].join('\n'),
    'The form, the email and password inputs and the submit and toggle buttons are listed by no state, so every state renders them; the forgot link is rendered only in the states that list it, and the password rule list with its items only in the states of the mode sign-up. `passwords-differ` handles `user.sign-in.password-confirmation-input`; without its list, `contract:check` would say `"user.sign-in.password-confirmation-input" is handled here but not rendered: only the states that list it in meta.renders render it`. A state that runs an action lists what stays on the page while it runs: `signing-up` lists the rule list, the confirmation and the name input, or they would go while the account is created. `contract:diff` lists each entry as a line `<state path> renders <anchor>`.',
    "Rendered means visible to the user. An anchor a state renders is on the page and seen; one it does not render is not seen: absent from the page, or kept in it hidden (`hidden`, `display: none` or `visibility: hidden`, as the page helper's `visible` reads it), as a form that keeps what was typed into it while it is closed. The app reads what a state renders from its machine, whose states carry the flow's `meta.renders`, through the engine's `renderedAt` and `isRendered` (`@workspace/ui-contract/anchors`; `isListed` says whether an anchor is rendered only where listed, and `listedBy(state)` is how all of them read one state's list), never from a flag of its own, as it reads which controls are enabled; the engine's comparison holds those lists to the flow's, and an e2e run holds the page to them in every settled state a test passes through (see the rule `settled-state`).",
    "`contract:check` holds `meta.renders`: it lists anchors its own screen declares (a derived part's base, never the part), each once and never beside an anchor it is declared under, and a plain state of the root or a state of a region renders every anchor only some states render that it handles (one declared under a listed anchor, through that anchor).",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.meta.renders',
    'screen.flow.states.<name>.states.<name>.states.<name>.meta.renders',
  ],
}

const renderSets: ReferenceRule = {
  id: 'render-sets',
  title: 'Anchors several states render, named once',
  text: "A flow may name a list of anchors several states render (`flow.meta.renders: { <set>: [anchors] }`); a state that lists the set's name in its `meta.renders` renders those anchors. A set serves two states or more.",
  keys: ['screen.flow.meta.renders'],
}

const withWithout: ReferenceRule = {
  id: 'with-without',
  title: 'When an element shows beside others: with and without',
  text: [
    "An element that shows only beside other elements of its screen, or only away from them, says so in its structure, never in its description: `with` lists the anchors each of which renders while it does, `without` those none of which renders while it does. An entry is an anchor of the element's own screen (the frame's, on the frame), or `{ <anchor>: [codes] }`, that anchor while it shows one of these codes. The element renders only while every `with` entry renders and no `without` entry does: that says when it may show, and its state (see the rule `renders`) and its data (its roles, its owner, its value, its entries) still decide whether it does. For the frame's reminder to install the app:",
    [
      '```yaml',
      'anchors:',
      '  app-shell.install-later-button:',
      '    kind: button',
      '    with: [ app-shell.install-message ]',
      '  app-shell.install-button:',
      '    kind: button',
      '    with: [ { app-shell.install-message: [ install-available ] } ]',
      '```',
    ].join('\n'),
    'An anchor rendered in each entry of a list, in the part of its `item` or `row` (`<part>.<name>`, like the entry) or declared under it (see the rule `entries-of-a-list`), names anchors of the same entry and means the same entry: `device.list.revoke-button` with `without: [ device.list.current-badge, device.list.revoked-cell ]` shows on every entry but the one of this device and those signed out already. An anchor outside the entries may name one of them, and then means any entry.',
    "`contract:check` refuses an entry that names the element itself; an anchor of another screen (a screen's element never names the frame's, nor the frame's a screen's) or one its screen does not declare; a code the named anchor does not carry, as loaded (the codes the loader derives included); an anchor named twice, in one list or in both; an anchor that names the element back, directly or through others, a cycle, which is said on one of its anchors only; and, under an entry, an anchor outside that entry. The manifest carries `with` and `without` in `ids`.",
    "An e2e run holds them in every settled state of the element's screen (see the rule `settled-state`), unless the element is rendered in each entry of a list, which the report does not tell apart: it is not visible while a `with` entry does not render or a `without` entry does. A state that lists the element in `meta.renders` requires it on the page only while its entries say it shows; while it is not visible, neither the parts derived from it nor the anchors nested under it are required. A control no state lists, which nothing besides its state decides, is visible once each of its `with` entries renders, one at least, and no `without` entry does; any other element shows by its own data too (a cell its value, a list its entries, a message its code), and an element with no `with` entry has nothing on the page that says the area holding it is shown. A code entry reads the `data-code` the report carries; where the report carries none, it is judged only when its anchor is not visible, and then it does not render.",
    "`with`: The element renders only while each of these renders: an anchor of its screen (the frame's, on the frame), or `{ <anchor>: [codes] }`, that anchor while it shows one of these codes.",
    "`without`: The element renders only while none of these renders: an anchor of its screen (the frame's, on the frame), or `{ <anchor>: [codes] }`, that anchor while it shows one of these codes.",
    '`with` and `without`: An anchor rendered in each entry of a list (in the part of its `item` or `row`, `<part>.<name>`, or declared under it) names anchors of the same entry, and means the same entry.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.with', 'screen.anchors.<name>.without'],
}

const anchorRoles: ReferenceRule = {
  id: 'anchor-roles',
  title: 'Who sees an anchor: its roles',
  text: [
    'The `roles` of an anchor say who sees it.',
    "A role is a row of the vocabulary's Roles table, and a device holds a set of them (see the rule `roles`).",
    "Every restriction above an anchor admits a device by the roles it holds together: its own `roles`, those of each anchor it is declared under and its screen's (the frame aside), so one restriction naming only roles the route serves is enough, wherever it sits on the chain, and a link to a route whose roles name neither `guest` nor `identity` is shown to no device the route refuses.",
    "`contract:check` wants an anchor's roles among those its screen's bindings serve; the manifest carries them, and `contract:diff` lists each role an anchor is shown to as `<anchor> <role>`.",
    "A state of a flow may list such an anchor in `meta.renders` like any other, and the state still bounds where it may be visible: an anchor a state does not render is never visible there, and the e2e run's settled check reports it. Where the state does render it, data (the account's roles) decides whether it shows, so the settled check does not require it to be on the page or visible there.",
    "A link bound to one route takes the roles of that route when it admits fewer devices than the screen serves: from version 4 the loader derives them and a file never writes roles that admit what the route's do (see the rule `link-roles`). With no `roles` on it, written or derived, and none on an anchor above it, it is shown to every role its screen serves, whoever is signed in.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.roles',
    'manifest.screens.anchors.<name>.roles',
    'manifest.ids.<name>.roles',
  ],
}

const ownEntries: ReferenceRule = {
  id: 'own-entries',
  title: 'When an element shows on the entries a member owns: own',
  text: [
    '`own`: Shown to a member only on the entries the member owns: the anchor sits in an entry of a list, and shows on the entries the member owns alone.',
    "A state of a flow may list it in `meta.renders` like any other anchor, and the state still bounds where it may be visible: a state that does not render it never shows it, which the e2e run's settled check reports. Where the state does render it, data (the owner of each entry) decides whether it shows, so the settled check does not require it to be on the page or visible there, as it does not for an anchor with `roles`, an entry (`dataId`) or an anchor nested under one of these.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.own',
    'manifest.screens.anchors.<name>.own',
    'manifest.ids.<name>.own',
  ],
}

const emptyList: ReferenceRule = {
  id: 'empty-list',
  title: 'A list with no entries',
  text: [
    'A list with no entries is not rendered, so it is not rendered before its first read answers, unless it carries a data state (`loading`, `empty`) that shows it waiting or empty.',
    "An e2e run holds it in every settled state (see the rule `settled-state`): a visible `list` none of whose entries is visible, an `item` or a `row` it contains (declared under it or beside it in its part, see the rule `entries-of-a-list`), is reported unless its `states` include `loading` or `empty`; a list that declares no entry is not judged. A state that lists such a list, any but a composite's, whose items are always there, does not require it on the page, nor its parts or what is nested under it while it is not visible.",
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.states'],
}

const emptyCell: ReferenceRule = {
  id: 'empty-cell',
  title: 'A cell with no value',
  text: [
    'A cell with no value is not rendered.',
    'So an e2e run never requires a cell to be visible, and a `with` entry that renders does not require the cell that shows with it (see the rule `with-without`).',
  ].join('\n\n'),
  keys: [],
}

const errorPlacement: ReferenceRule = {
  id: 'error-placement',
  title: 'Where an error shows each code',
  text: 'An error shows each code it carries in its own element: a code its `fields` maps to a field shows under that field and marks it invalid; a code mapped to `form`, or not mapped, shows beside the controls of its part (`<part>.*`), or alone where the part has none.',
  keys: ['screen.anchors.<name>.fields', 'screen.anchors.<name>.codes'],
}

/** The rules of what a state renders, of when an element shows, and where an error shows. */
export const RENDER_RULES: readonly ReferenceRule[] = [
  stateRenders,
  renderSets,
  withWithout,
  anchorRoles,
  ownEntries,
  emptyList,
  emptyCell,
  errorPlacement,
]
