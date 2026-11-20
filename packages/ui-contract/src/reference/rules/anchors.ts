/**
 * The rules of an anchor: its grammar, how it is written in code, the attributes it carries, the
 * eye of a password input, how a page is marked and located, and the frame's readiness and notices.
 */

import type { ReferenceRule } from '../rule'

const anchorGrammar: ReferenceRule = {
  id: 'anchor-grammar',
  title: 'Anchors: the grammar and one literal per name',
  text: [
    'An anchor is the value of `data-testid`: 2 to 4 dot-separated kebab-case segments, the screen name first (`user.sign-in`, `organisation`) and the kind last, as the last dash-separated word of the last segment. Each segment is a kebab-case word group (`[a-z][a-z0-9]*(-[a-z0-9]+)*`); the first one or two segments are a screen name from the vocabulary\'s "Screen names in use" (the longest match on segment boundaries wins), and the last is `<object>-<kind>` or just `<kind>`. `user.sign-in.email-input` is an `input` of the sign-in screen, `organisation.notes.item` an `item` of the organisation screen. The kinds are a closed list in the vocabulary, each with the Playwright role it maps to. An anchor names what the element is for: never its text, its colour, its position or an entity\'s id.',
    "A derived anchor adds one suffix from the vocabulary's closed table for a part a composite renders itself: `user.profile.sign-out-dialog.confirm-button`, `app-shell.locale-select.option`. Code builds it only with `testIdFor(base, suffix)` from `@workspace/ui-contract/anchors`, and the loaded base lists the suffix in its `derived`: a file writes it there, except for the parts a kind brings by itself from version 4 (see the rule `kind-parts`) and a paged list's parts (see the rule `paged-list`), which the loader lists alone. A rendered anchor, base or derived, has up to 5 segments and matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*(\\.[a-z][a-z0-9]*(-[a-z0-9]+)*){1,4}$`. Every derived suffix ends with a kind of the vocabulary, the kind of the part it marks. A known anchor is a declared anchor, a declared base followed by a suffix of the vocabulary's table, or a paged list's size options (`isKnownAnchor(anchor, declared, suffixes, paged)` checks the suffix against the table and the base against the declared anchors, and cannot see the base's `derived`; `baseOf(anchor, suffixes)`, `sizeOptionOf(list)`, `isSizeOption(anchor, paged)`); `ANCHOR_PATTERN` and `isAnchor(text)` hold the grammar, `segmentsOf(anchor)` splits an anchor, `kindOf(anchor)` is the last dash-separated word of its last segment, and `screenOf(anchor, screenNames)` the longest screen name on segment boundaries.",
    'One literal per rendered name:',
    [
      '- every anchor is declared once, in one screen file, and written once in the sources;',
      '- no anchor equals another one plus a derived suffix: the entries of `device.list` are `device.list.session-item`, never `device.list.item`, which would read as a part the list renders itself;',
      '- an `item`, `row` or `option` is the one anchor that marks many elements: every entry of its container, told apart by `data-id` or `data-value`.',
    ].join('\n'),
    "So a search finds every place a name lives. A grep for the full name of a derived anchor finds every explicit reference to it: the scenarios and tests that use it, a `flow` event or a choice value that names it, a view's unit test that writes it as a literal. Its declaration is found by the base, and so is the view that renders the part, which passes the base to the composite. A part its kind brings by itself has no line of its own in a file from version 4 (before, a file may list it in the base's `derived`): the declaration of the base, whose kind brings it, is where to read it:",
    [
      '```sh',
      "git grep -nF 'user.profile.sign-out-dialog.cancel-button'   # the explicit references",
      "git grep -nF 'user.profile.sign-out-dialog'                 # the declaration and the view too",
      '```',
    ].join('\n'),
    'A derived name may have no reference in the screens, the scenarios or the tests at all: `app-shell.locale-select.option` is named only by the vocabulary (its choice values and the reserved row of its base), and `app-shell.locale-select`, a select, declares it: a select brings its `option`s by itself from version 4, and before that a file may list `option` in its `derived`.',
    'In code an anchor is a literal in one of four forms, the only ones the sources check reads:',
    [
      '```tsx',
      '<h1 data-testid="user.profile.heading">{profile.name}</h1>  // the attribute',
      '<ConfirmDialog testId="user.profile.sign-out-dialog" />      // a testId prop',
      '<AppShell navigationTestId="app-shell.nav" />                // a prop named <part>TestId',
      "{ to: '/me', testId: 'app-shell.nav.profile-link' }          // a static testId key",
      "const NOTES_ITEM_TEST_ID = 'organisation.notes.item'         // a <NAME>_TEST_ID constant",
      '```',
    ].join('\n'),
    'The first four are in the views today; the constant is the form for one element that two render paths draw, and no view needs it yet. A name, a member such as `props.testId` or a `testIdFor()` call passes on a literal written elsewhere. An anchor built at runtime (a template with `${}`, `+`, a conditional between strings) is a problem: choose between two literals, pass a prop, or derive the part.',
  ].join('\n\n'),
  keys: [
    'screen.anchors',
    'screen.anchors.<name>',
    'screen.anchors.<name>.kind',
    'screen.anchors.<name>.derived',
  ],
}

const visibilityButton: ReferenceRule = {
  id: 'visibility-button',
  title: 'The visibility button of a password input',
  text: [
    'One derived part is presentation only: `visibility-button`, the eye a password input renders beside itself, which shows what the input holds as typed or hides it again. From version 4 the loader derives it on a secret `input` (`secret: true`; see the rule `kind-parts`), and before that the input may list it, `derived: [ visibility-button ]`; only a secret `input` has one: on any other field there is nothing hidden for it to show.',
    "Its `data-value` names what a click does: `show` while the input hides its value, `hide` while it shows it; the two values are the suffix's own (`VISIBILITY_VALUES`), never rows of the vocabulary's Choice values. Whether the field shows its value is held by the field itself, the one transient state a flow never holds, so the button is never an event of a flow or an activity, it is not one of the controls the machine enables, it is always enabled, and it holds no input, so no binding's `params` and no invoke's `input` takes it (`contract:check` refuses each of these, and a `clear` or a `read` naming it). A test locates it as `<input>.visibility-button` and asserts `show` or `hide` on it; the manifest lists it in `contract.derivedParts` with its kind and its values. A scenario may name the values `show` and `hide` once an input renders it.",
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.secret', 'screen.anchors.<name>.derived'],
}

const attributes: ReferenceRule = {
  id: 'attributes',
  title: 'Attributes: data-id, data-value, data-state, data-code',
  text: [
    [
      '- `data-id` on an `item` or `row`: the id of the entity the entry shows.',
      '- `data-value` on an `option`, a `badge` or a `button` that switches a mode: the stable key of a choice that is not an entity, the key the code already uses and never its label. Each fixed value is a row of "Choice values" with its meaning. On a `visibility-button` it is `show` or `hide`, the values of its suffix; on an option of a paged list\'s `size-select`, the page size it chooses.',
      '- `data-from`, `data-to` and `data-total` on the `range` of a paged list: the first and the last entry the page shows, from 1 (`0` and `0` when it shows none), and how many the search finds in all.',
      '- `data-state` on a `status`, `list`, `section` or `item`: an app, container or row state; on a field (an `input`, `textarea` or `select`), `unsaved` or `saved`, from the vocabulary\'s "Field states".',
      '- `data-code` on a `message`, `error`, `toast` or `dialog`: the stable code of what it says.',
    ].join('\n'),
    "The page speaks the user's language, so tests and agents never assert its words. They assert the anchor with its code, state, id or value. A behaviour that varies is a code or a state of one anchor, never a second anchor: the sign-in form has one `user.sign-in.toggle-button` whose `data-value` says which way it switches, and one `user.sign-in.error` whose code says what went wrong. A dialog's code names what it asks (`unsent-changes`), since every dialog looks alike. A domain code (`profile:FORBIDDEN`) is mapped to a contract code (`forbidden`) in the presentation layer and never reaches `data-code`.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.codes',
    'screen.anchors.<name>.states',
    'screen.anchors.<name>.dataId',
    'screen.anchors.<name>.dataValue',
  ],
}

const marking: ReferenceRule = {
  id: 'marking-a-page',
  title: 'Marking a page and locating an element',
  text: [
    "**Placement.** The anchor goes on the semantic element whose role its kind maps to: the button, the input, the `li` of an entry, the dialog's own box. Never on a layout wrapper, a fragment, a portal or a backdrop: those change when a component is rewritten, the semantic element stays. `ConfirmDialog` puts its anchor on the dialog's popup, not on the portal or the overlay around it. A leaf kit component spreads its props, so the call site writes the literal.",
    [
      '**What needs an anchor.**',
      '',
      '- A container that scopes a test: a page `status`, a `form`, a `list`, a `section`, a `dialog`, a `panel`.',
      '- Every entry of a list (`item`, `row`, `option`).',
      '- Every control a test or an agent drives. Every label is translated, so no visible label is a stable locator.',
      '- A value a test reads (`heading`, `cell`, `badge`), and every state and message (`status`, `message`, `error`).',
    ].join('\n'),
    'What does not: decorative elements, layout wrappers, a `div` that scopes nothing, an icon inside a marked control. A control that is not a test target is declared so with a coverage-ignore marker and its reason (`// ui-contract-ignore: <reason>`), never given a made-up anchor.',
    '**Icon-only controls** also carry an `aria-label` from a translation key, so a screen reader and an agent reading the accessibility tree can name them.',
    "**Repeated items.** One static anchor marks every entry, and the entity's id goes into `data-id`: `device.list.session-item` with `data-id` = the device session. An entry whose entity differs from the others, or changes while it stays listed, carries a row state; an entry in its normal state carries none (`current` for this device, `revoked` for one signed out, nothing for the others).",
    "**Composites and the shell's anchors.** A composite takes one `testId` and derives its parts. A composite that can be mounted on its own is not a singleton: the shell's instance owns a reserved anchor, and every other mount passes its own `testId`. `OptionSelect` is the shell's language select, which owns the reserved `app-shell.locale-select`, and the organisation page's choice of organisation, which passes `organisation.page.current-select`. Each `ConfirmDialog` is mounted by its view with an anchor of that view's screen (`user.profile.sign-out-dialog`, `device.everywhere.dialog`). A feature never declares or renders a reserved anchor.",
    [
      '**Locating an element**, in this order, stopping at the first that works:',
      '',
      "1. `getByTestId('<anchor>')`.",
      "2. `getByRole('<role>')` without a name, inside the container found by its anchor.",
      '3. `getByLabel(...)`.',
      '4. `getByPlaceholder(...)`.',
    ].join('\n'),
    'Text is used only for text the test itself entered (a note it wrote, an email it invited). Never a CSS class or the shape of the DOM; a selector over the contract\'s attributes is fine: `[data-testid="organisation.notes.item"][data-id="..."]`. When a test has to fall back to steps 3 or 4, the element needs an anchor: ask for one.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.kind', 'screen.anchors.<name>.dataId'],
}

const readiness: ReferenceRule = {
  id: 'readiness',
  title: 'Readiness and container states',
  text: [
    'Wait for `app-shell.status` to reach the state `ready` (`[data-testid="app-shell.status"][data-state="ready"]`): the frame and the screen are rendered. Its other states, and what each means, are the vocabulary\'s table "App states". Then wait for the screen\'s container to leave `loading`: a `list`, a `section` or a page `status` carries one of the vocabulary\'s "Container states".',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.states'],
}

const notices: ReferenceRule = {
  id: 'notices',
  title: 'Notices and ranked messages',
  text: [
    '`app-shell.notice-message` shows one notice at a time, the latest, and it outlives the page that raised it (a notice an action raises just before its flow navigates shows on the page it navigates to). Find it by its anchor and its code together, right after the action that raises it.',
    'A message whose codes more than one source may raise before it shows (an effect of the app and a `show` of a flow on its way there) says which one it shows in its structure: `ranked: true`, with its `codes` in rank order. Of the codes raised before it shows, it shows the first, and the others go with it. A code raised waits until the message shows or a flow clears it: a `clear` of the message, in any flow, takes away every code raised before it. `contract:check` takes `ranked` on a message of two codes or more, each listed once, and `contract:diff` lists each ranked message with its order.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.ranked', 'screen.anchors.<name>.codes'],
}

const entriesOfAList: ReferenceRule = {
  id: 'entries-of-a-list',
  title: 'The entries of a list and the controls that act on them',
  text: [
    'An `item` or a `row` (`ENTRY_KINDS`) marks every entry of its list, table or section (`LISTING_KINDS`), which `data-id` tells apart. The container an entry belongs to is a list, a table or a section of its screen that it is declared under (`device.list.session-item` under `device.list`), the nearest first, then one declared beside it in its part (`organisation.notes.item` beside `organisation.notes.list`): `containersOf(entry, anchors)`.',
    "A control in the entry's part (`<part>.<name>`, like the entry, and never the entry itself: `inPartOf(entry, control)`) is rendered in each entry and acts on the entry it is in, whose `data-id` it gives. `CONTROL_KINDS` are the kinds a person acts on: a button, a link, a tab and the `FIELD_KINDS` (`input`, `textarea`, `select`, `checkbox`, `radio`, `switch`). `itemIdOf(control, item)` is the `data-id` of the entry of `item` the control is in, the closest element whose anchor is `item`, which a navigate's `{ item }` search takes: the app reads it off the page, so the id that reaches the address is the attribute a test reads, never one the view passes beside it. A control outside such an entry, or an entry without an id, is a defect of the view, never guessed: it throws.",
    '`isUnder(anchor, other)` says `other` is `anchor` or an anchor under it (`<anchor>.<rest>`), and `partOf(anchor)` is the part it sits in, the anchor without its last segment.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.dataId', 'screen.anchors.<name>.binding'],
}

/** The rules of an anchor and of the attributes it carries. */
export const ANCHOR_RULES: readonly ReferenceRule[] = [
  anchorGrammar,
  visibilityButton,
  attributes,
  entriesOfAList,
  marking,
  readiness,
  notices,
]
