# UI contract

This folder describes the web application as tests, agents and people see it: the data
model, the screens that unfold it, the anchors on those screens and what each anchor is
bound to. It is written before the code, and the code, the e2e tests and the scenarios are
checked back against it.

## The principle

The contract follows a well-tried test-id convention: an attribute on every element a test
needs, a closed grammar for its value, codes instead of wording, and a manifest that every
stand serves. Three changes adapt it to this project:

- **Model first.** Completeness comes from the model, not from the page. The entities of
  `model.schema.json` say what exists, field by field and action by action. A screen
  unfolds the model: its anchors bind those fields and actions, and the page is that screen
  rendered. The contract is never collected from the page; the page is checked against
  it.
- **Routes in TanStack Router's format.** A screen's bindings are routes the application's
  router takes as they are, and a route is a state address: the same path with the same
  search reaches the same state after a reload.
- **YAML for the authored screens.** Each screen is one YAML file named by its pathname,
  validated by a Zod schema that also generates the JSON Schema an editor uses.

The contract is the authority. The DOM is checked against it (`contract:check:sources`),
the e2e tests are checked against it (`contract:check:consumers`), and the scenarios report
back the gaps they find. The first pass filled the contract from the existing pages once, to
lay down its skeleton: that was the one DOM-first fill, by design, and it ended with both
sides in sync. From now on a change starts in the contract, never in JSX or in a test. A
page may still inspire a change, but the contract decides it.

### The order of work

1. **The model.** A new field or action goes into its entity in `model.schema.json`
   (`properties`, `x-perch.actions`); an action of the platform goes into `platform.yaml`.
2. **The screen file.** The routes, the anchors that bind the field or the action, their
   codes, states and values, the `flow` and the `wireframe`. A word the vocabulary lacks is
   added to its table in the same change.
3. **The scenario.** The behaviour as a person would check it by hand, written from the
   contract alone, in `tests/e2e/scenarios/`.
4. **The code.** The view renders exactly the anchors of the screen file, and
   `bun run contract:check:sources` holds it to them.
5. **The tests.** The test of the scenario uses the anchors, codes, states and values of the
   contract, and `bun run contract:check:consumers` holds it to them.

## The folder

The authored files, edited by hand or by a model in the modeling thread:

- `vocabulary.md`, Markdown: the closed lists, one table per section (the kinds of anchors,
  the derived suffixes, the attributes, the app, container and row states, the codes, the
  choice values, the screen names, the roles and the anchors the shell reserves). Its
  `Grammar` section says how an anchor is spelled. The loader reads each table by its fixed
  heading.
- `screens/<pathname>.yaml`: one screen per file, named by the path of the screen's first
  binding without the leading `/`. `/sign-in` is `screens/sign-in.yaml` and `/me` is
  `screens/me.yaml`; a nested path is a folder (`/org/$org` would be `screens/org/$org.yaml`)
  and `/` would be `screens/index.yaml`. The frame, the one screen without a binding, is
  `screens/__root.yaml`, as in file-based routers. The screen's `id` (`user.profile`) is the
  prefix of its anchors, not its file name. The loader reads the folder sorted by path; a
  file that is not `.yaml`, or one named otherwise than its first binding says, is a problem
  of that file.
- `platform.yaml`: the contract version, which equals the vocabulary's `Contract version`
  line and the tooling's `CONTRACT_VERSION`, and the platform section: the actions every
  screen may run (signing up, in and out, organisations, devices), the reserved anchors and
  the readiness line.
- `model.schema.json`: the data model, a JSON Schema 2020-12 document with one `$defs` entry
  per entity and the contract's `x-perch` keyword (table, region, id prefix, owner, rules,
  actions, how each field merges).

Each YAML file opens with a comment that points an editor at its schema, so the editor
validates and completes it; the loader does not read the comment:

```yaml
# yaml-language-server: $schema=../screen.schema.json
```

`platform.yaml` points at `./platform.schema.json`, and a screen file one folder deeper
points one folder further up.

Generated beside them, never edited by hand: `screen.schema.json` (one screen file),
`platform.schema.json` (the platform file), `x-perch.schema.json` (the `x-perch` keyword of
the model) and `manifest.schema.json` (the manifest). `bun run contract:schemas` writes them
from the Zod sources of `@workspace/ui-contract`, and the contract check fails when they
drift. `COVERAGE.md` is a note, not a contract file: `bun run contract:coverage --write`
rewrites its block.

The scenarios are part of the contract's input too, but they live in the e2e tree beside
their tests, in `tests/e2e/scenarios/` (see "Scenarios").

### The layout of a screen file

The loader accepts any valid YAML. Files written by hand follow one layout, so they read
alike:

- keys in the order `id`, `title`, `description`, `frame` or `flag`, `bindings`, `entry`, then the rest;
- flow style, on one line, for `bindings` and each binding with everything it holds: its
  `roles`, `params`, `search`, `history` and `retain`, nested maps included (the test
  fixture `packages/ui-contract/src/__fixtures__/contract/screens/sample/$key.yaml` has a
  binding whose `params` is a nested JSON Schema, still on one line);
- flow style for `entry`, and inside an anchor for its `roles`, `codes`, `states` and
  `derived` lists and for a `binding` that is one map with no map inside
  (`binding: { model: profile.name }`, `binding: { action: platform.sign-out }`);
- block style for the rest: the `anchors` map and each anchor in it, an anchor's `binding`
  that is a list or holds a map (its action's `params` included), the screen's `states`, its
  `flow` with everything inside it, a `source`, and the `wireframe` as a block scalar.

An excerpt of `screens/me.yaml`:

```yaml
# yaml-language-server: $schema=../screen.schema.json
id: user.profile
title: Profile
description: "The signed-in account's own profile: its name and bio, saved together and kept in step across the account's devices; signing this device out, with a warning when changes are unsent."
flag: null
bindings: [ { path: /me, guard: authenticated, roles: [ identity ], history: push } ]
entry: [ user.profile.heading, user.profile.form, user.profile.save-button ]
anchors:
  user.profile.status:
    kind: status
    description: Shown instead of the profile until it is read, and when the account has no profile.
    states: [ loading, empty ]
  user.profile.heading:
    kind: heading
    description: The name of the account, as stored.
    binding: { model: profile.name }
  user.profile.save-button:
    kind: button
    description: Saves the name, then the bio, each only when it changed; disabled while the save runs.
    binding:
      - action: profile.updateName
        params:
          name: user.profile.name-input
      - action: profile.updateBio
        params:
          bio: user.profile.bio-textarea
```

## Reading a screen file

A screen's `title` is what a reader calls it, and its `description` says what the screen is
for: the task it serves and when it is shown, in one or two sentences, so an agent chooses
the screen before it reads the anchors.

A screen's `bindings` are its routes in the router's format: `path` (static segments,
`$param`, `{-$param}` for an optional one, `$` for a splat), `guard` (`guest`: only a
visitor; `authenticated`: only a signed-in account), the `roles` it serves, `params` and
`search` as flat JSON Schemas, `history` (`push` or `replace`) and `retain`. The frame
(`app-shell`, `frame: true`) has no route: it is around every screen. Every binding `path`
is a TanStack Router path in the router's own syntax, `params` are its path parameters and
`search` its search parameters, and a route is a state address: the same path with the same
search reaches the same state after a reload. The application's router builds and matches
every binding (`apps/web/src/platform/routes-router.spec.ts`), and the module routes equal
the bindings (`routes-contract.spec.ts` beside it).

A screen's `entry` lists the anchors a test starts from on the screen. Some of them are
alternatives by state, so a test waits for the one its state shows, never for all of them:

- `user.profile`: `user.profile.heading`, `user.profile.form` and `user.profile.save-button`
  once the profile is read (`ready`); until then, and when the account has no profile,
  `user.profile.status` shows instead (`loading`, `empty`).
- `organisation`: `organisation.page.status` without a membership (`empty`);
  `organisation.page.heading` and `organisation.notes.section` with a current organisation
  (the section in `loading`, `ready` or `empty`); `organisation.create.form` without a
  membership, or after its toggle.
- `device`: `device.page.status` while the devices are read (`loading`), `device.list` once
  they are (`ready`); `device.everywhere.open-button` in both.

An anchor's `binding` says what the element does or shows:

- `{ model: <entity>.<field> }`: a field of `model.schema.json` (`$defs.<entity>`).
- `{ action: <entity>.<action>, params: { ... } }`: an action of the entity's
  `x-perch.actions`; `{ action: platform.<name> }`: an action of the platform section. Each
  parameter names the anchor whose value it takes, or a constant `{ value: true }`.
- `{ route: /path }`: the path of a binding of some screen.

A list of bindings means the anchor runs them in that order, or one of them by the mode of
the screen; its `flow` says which. The other fields of an anchor: `codes` (the `data-code`
values the element carries), `dataId` (what its `data-id` holds), `dataValue` (it, or its
derived options, carry a `data-value` from the choice values), `states` (its `data-state`
values), `derived` (the suffixes it renders), `roles` (who sees it; absent: every role of the
screen), `own` (a member sees it only on its own entries), `source` (where a list's entries
come from).

A screen's `states` say what is visible in each container state; its `flow` lists its
states and, per event on an anchor, the action it runs and what follows (a route, codes, a
new state). The `wireframe` is the default state in Playwright's aria snapshot grammar.

## Anchors

An anchor is the value of `data-testid`: 2 to 4 dot-separated kebab-case segments, the
screen name first (`user.sign-in`, `organisation`) and the kind last, as the last
dash-separated word of the last segment. `user.sign-in.email-input` is an `input` of the
sign-in screen, `organisation.notes.item` an `item` of the organisation screen. The kinds
are a closed list in the vocabulary, each with the Playwright role it maps to. An anchor
names what the element is for: never its text, its colour, its position or an entity's id.

A derived anchor adds one suffix from the vocabulary's closed table for a part a composite
renders itself: `user.profile.sign-out-dialog.confirm-button`,
`app-shell.locale-select.option`. Code builds it only with `testIdFor(base, suffix)` from
`@workspace/ui-contract/anchors`, and the base lists the suffix in its `derived`.

One literal per rendered name:

- every anchor is declared once, in one screen file, and written once in the sources;
- no anchor equals another one plus a derived suffix: the entries of `device.list` are
  `device.list.session-item`, never `device.list.item`, which would read as a part the list
  renders itself;
- an `item`, `row` or `option` is the one anchor that marks many elements: every entry of
  its container, told apart by `data-id` or `data-value`.

So a search finds every place a name lives. A grep for the full name of a derived anchor
finds every explicit reference to it: the scenarios and tests that use it, a `flow` event or
a choice value that names it, a view's unit test that writes it as a literal. Its
declaration is found by the base, which lists the suffix in its `derived`, and so is the
view that renders the part, which passes the base to the composite:

```sh
git grep -nF 'user.profile.sign-out-dialog.cancel-button'   # the explicit references
git grep -nF 'user.profile.sign-out-dialog'                 # the declaration and the view too
```

A derived name may have no reference in the screens, the scenarios or the tests at all:
`app-shell.locale-select.option` is named only by the vocabulary (its choice values and the
reserved row of its base), and `app-shell.locale-select` with `derived: [ option ]` declares
it.

In code an anchor is a literal in one of four forms, the only ones the sources check reads:

```tsx
<h1 data-testid="user.profile.heading">{profile.name}</h1>  // the attribute
<ConfirmDialog testId="user.profile.sign-out-dialog" />      // a testId prop
<AppShell navigationTestId="app-shell.nav" />                // a prop named <part>TestId
{ to: '/me', testId: 'app-shell.nav.profile-link' }          // a static testId key
const NOTES_ITEM_TEST_ID = 'organisation.notes.item'         // a <NAME>_TEST_ID constant
```

The first four are in the views today; the constant is the form for one element that two
render paths draw, and no view needs it yet. A name, a member such as `props.testId` or a
`testIdFor()` call passes on a literal written elsewhere. An anchor built at runtime (a
template with `${}`, `+`, a conditional between strings) is a problem: choose between two
literals, pass a prop, or derive the part.

## Attributes

- `data-id` on an `item` or `row`: the id of the entity the entry shows.
- `data-value` on an `option`, a `badge` or a `button` that switches a mode: the stable key
  of a choice that is not an entity, the key the code already uses and never its label. Each
  fixed value is a row of "Choice values" with its meaning.
- `data-state` on a `status`, `list`, `section` or `item`: an app, container or row state.
- `data-code` on a `message`, `error`, `toast` or `dialog`: the stable code of what it says.

The page speaks the user's language, so tests and agents never assert its words. They assert
the anchor with its code, state, id or value. A behaviour that varies is a code or a state of
one anchor, never a second anchor: the sign-in form has one `user.sign-in.toggle-button`
whose `data-value` says which way it switches, and one `user.sign-in.error` whose code says
what went wrong. A dialog's code names what it asks (`unsent-changes`), since every dialog
looks alike. A domain code (`note:FORBIDDEN`) is mapped to a contract code (`forbidden`) in
the presentation layer and never reaches `data-code`.

## Marking a page

**Placement.** The anchor goes on the semantic element whose role its kind maps to: the
button, the input, the `li` of an entry, the dialog's own box. Never on a layout wrapper, a
fragment, a portal or a backdrop: those change when a component is rewritten, the semantic
element stays. `ConfirmDialog` puts its anchor on the dialog's popup, not on the portal or
the overlay around it.

**What needs an anchor.**

- A container that scopes a test: a page `status`, a `form`, a `list`, a `section`, a
  `dialog`, a `panel`.
- Every entry of a list (`item`, `row`, `option`).
- Every control a test or an agent drives. Every label is translated, so no visible label is
  a stable locator.
- A value a test reads (`heading`, `cell`, `badge`), and every state and message
  (`status`, `message`, `error`).

What does not: decorative elements, layout wrappers, a `div` that scopes nothing, an icon
inside a marked control. A control that is not a test target is declared so with a
coverage-ignore marker and its reason (see "Coverage"), never given a made-up anchor.

**Icon-only controls** also carry an `aria-label` from a translation key, so a screen reader
and an agent reading the accessibility tree can name them.

**Repeated items.** One static anchor marks every entry, and the entity's id goes into
`data-id`: `device.list.session-item` with `data-id` = the device session. An entry whose
entity differs from the others, or changes while it stays listed, carries a row state; an
entry in its normal state carries none (`current` for this device, `revoked` for one signed
out, nothing for the others).

**Composites and the shell's anchors.** A composite takes one `testId` and derives its parts.
A composite that can be mounted on its own is not a singleton: the shell's instance owns a
reserved anchor, and every other mount passes its own `testId`. `OptionSelect` is the shell's
language select, which owns the reserved `app-shell.locale-select`, and the organisation
page's choice of organisation, which passes `organisation.page.current-select`. Each
`ConfirmDialog` is mounted by its view with an anchor of that view's screen
(`user.profile.sign-out-dialog`, `device.everywhere.dialog`). A feature never declares or
renders a reserved anchor.

## Locating an element

In this order, and stop at the first that works:

1. `getByTestId('<anchor>')`.
2. `getByRole('<role>')` without a name, inside the container found by its anchor.
3. `getByLabel(...)`.
4. `getByPlaceholder(...)`.

Text is used only for text the test itself entered (a note it wrote, an email it invited).
Never a CSS class or the shape of the DOM; a selector over the contract's attributes is
fine: `[data-testid="organisation.notes.item"][data-id="..."]`. When a test has to fall back
to steps 3 or 4, the element needs an anchor: ask for one (see "Asking for a missing
anchor").

## Readiness and container states

Wait for `app-shell.status` to reach the state `ready`
(`[data-testid="app-shell.status"][data-state="ready"]`): the frame and the screen are
rendered. Its other states are `opening`, `failed` and `storage-blocked`. Then wait for the
screen's container to leave `loading`: a `list`, a `section` or a page `status` carries
`loading`, `ready`, `empty` or `error`.

## Notices

`app-shell.notice-message` shows one notice at a time, the latest, and it outlives the page
that raised it (the welcome after sign-up shows on the profile). Find it by its anchor and
its code together, right after the action that raises it.

## Scenarios

A scenario is an instruction a person could follow by hand, one Markdown file each, in the
e2e tree beside its test:

```text
tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md
tests/e2e/src/<entity>/<layer>/[<area>/]<slug>.e2e.spec.ts
```

The id is the file's path under `tests/e2e/scenarios/` without `.md`, never written inside
the file: `user/base/edit-profile-name`. Its segments go from the general to the specific:

- the entity the scenario checks: `user`, `device`, `organisation`, and `contract` for the
  contract itself;
- the layer: `base` (the entity works on its own; an area such as `crud` or `list` when it
  helps), `flows` (several roles or devices meet) or `features` (how one function behaves);
- an optional area, then a kebab-case slug.

No numbers: the tree orders the scenarios and the tags select them. The role is a property
of the scenario, in its front matter, never a folder. A path that does not match
`^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*){2,3}$`, or whose layer is not one of the three, is a
problem of its file.

The file opens with a YAML front matter that holds only the structured header:

- `tags`: a list holding `smoke` or `full`;
- `devices`: a letter per browser with the role it acts as by the end of the scenario; every
  device starts as `guest` until a step signs it in;
- `data`: the test data by name, `generate` or a fixed string; `{}` when there is none.

Then the body, with fixed sections in any order: `# <title>`, a line `Where: <text>`,
`## Scenario: <sentence>`, `### Steps` with a numbered list and `### Expected result` with a
bullet list. An unknown heading, a line outside a section, a missing section or a list item
of the wrong shape is a problem, with a line number where the parser knows it (a missing
section has none). The whole of
`tests/e2e/scenarios/user/base/edit-profile-name.md`:

```markdown
---
tags:
  - smoke
devices:
  A: identity
data:
  New name: generate
---
# Rename yourself on the profile page

Where: [/me] then [user.profile.save-button]

## Scenario: A signed-in user changes their name and keeps it after a reload

### Steps
1. Open [/me] and wait for [app-shell.status] to reach [state:ready]
2. Clear [user.profile.name-input]
3. Enter the new name into [user.profile.name-input]
4. Click [user.profile.save-button]

### Expected result
- After step 4 [app-shell.notice-message] carries [code:profile-saved]
- [user.profile.heading] shows the new name
- Reloading the page keeps the new name
```

Brackets reference the contract, and the contract check resolves each one: `[<anchor>]` (a
declared anchor, or one derived from a declared base with a suffix it lists), `[/path]` (the
path of a binding), `[code:<code>]`, `[state:<state>]` and `[value:<value>]`.

The test pairs with the scenario by its path and names it on its first line,
`// scenario: user/base/edit-profile-name`, with one `test.step` per step.
`bun run e2e:scaffold <id>` writes a failing test from a new scenario, and
`bun run e2e:coverage` checks the pairs.

The scenarios are the contract's feedback loop. A scenario is written from the contract
alone: when it needs an anchor, a code, a state, a route or a role the contract lacks, that
gap is fixed in the contract files first, never worked around in a test.

## The checks

`bun run check` and the pre-commit hook run three contract checks. Each prints
`file:line: message` per problem and exits 1, or a one-line summary.

- `bun run contract:check`: the files on their own and against each other. Each file parses
  and holds its shape, and each screen file is named by its first binding; every anchor
  follows the grammar, starts with its screen's id and is declared once; every kind,
  suffix, state, code, role and choice value is in the vocabulary, and every code of the
  vocabulary is used; every binding points at a field, an action or a route that exists,
  and every path parses in the router's syntax; the versions agree; the generated schemas
  equal their Zod sources; every bracket reference of a scenario resolves, and every device
  acts as a role of the vocabulary.
- `bun run contract:check:sources`: the JSX of `apps/web/src` and `packages/ui/src` against
  the contract. It reads the four literal forms and wants each literal written once, the
  literals equal to the anchors of the screen files (an anchor no source renders is a
  problem too), no literal equal to another plus a derived suffix, and every `testIdFor()`
  suffix and every code in the vocabulary. An anchor built at runtime is a problem.
- `bun run contract:check:consumers`: the e2e tests under `tests/e2e/src` against the
  contract. It reads `getByTestId('...')`, the selectors `[data-testid="..."]`,
  `[data-code="..."]`, `[data-state="..."]` and `[data-value="..."]` in any string or
  template, and `expect(...).toHaveAttribute(...)` on `data-testid`, `data-code`,
  `data-state` or `data-value`, `.not` included. Every anchor must be declared, or derived
  from a declared base with a suffix it lists; every code, state and value must be in the
  vocabulary. A plain string or a template without `${}` is a literal; an anchor built with
  `${}` or held in a name is a runtime anchor and a problem, while a code, a state or a value
  from an expression is a parameter of the test and passes. A helper such as
  `notice(page, 'profile-saved')` is not followed, and a `data-id` is data, not contract.

Beside them, `bun run e2e:coverage` (in `bun run check`) pairs every scenario with its test,
and the web app's tests hold the module routes and the real router to the bindings.

## The manifest

`bun run contract:manifest` builds `ui-manifest/manifest.json` from the contract files and
the scenarios, only after the contract check passes, and validates it against
`manifest.schema.json` before it writes anything. The web build writes it into
`apps/web/dist/ui-manifest/`, and both stands serve it at `/ui-manifest/manifest.json`, with
`manifest.schema.json` and `model.schema.json` beside it and `Cache-Control: no-store`.
`PERCH_UI_MANIFEST=0` on a stand answers 404 there.

It is what a tool outside the repository reads: the vocabulary as tables with prose
instructions for an agent, the screens and the platform section verbatim, the scenarios
parsed, the route parameters, the model, and `ids`, every declared anchor with its kind, its
screen and its attributes, one entry per line, so a search for an anchor in the manifest
shows its facts.

On a development build, and on a production build made with `PERCH_UI_HOOKS=1` (the e2e
stand's), `window.__perch.ui.anchors()` lists the anchors the page renders now, each with
its kind, `data-state`, `data-code`, `data-id`, `data-value` and visibility, with the page's
URL. Without the helper, the names a page renders are still there:

```js
;[...document.querySelectorAll('[data-testid]')].map((element) => element.dataset.testid)
```

## Coverage

`bun run contract:coverage` prints how far the contract reaches, and `--write` puts the same
block into `COVERAGE.md`. It is a report, not a gate.

1. **The model**, the measure of completeness: per entity of `model.schema.json`, each field
   and each action with the anchors whose `binding` names it, or `unbound`. A field may be
   internal (an id, a creation time), so an unbound one is a question, not an error.
2. **The controls**, the secondary measure: per feature module and for the UI kit, how many
   controls carry an anchor, which are left unmarked and which are declared off the
   coverage. `--unmarked` lists the unmarked and the ignored ones as `file:line: <element>`.

A control that is not a test target is declared off the coverage by a marker right before
its element, with only white space between, and its reason on the marker line itself, at
least three characters long. From `packages/ui/src/components/ui/sheet.tsx`:

```tsx
render={
  // ui-contract-ignore-self: no screen renders a sheet yet; the first one anchors it
  <Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />
}
```

In code it is a line comment, `// ui-contract-ignore: <reason>`; among JSX children it is
the only content of a comment container, `{/* ui-contract-ignore: <reason> */}`.
`ui-contract-ignore` covers the element and everything inside it, `ui-contract-ignore-self`
the element alone. A marker without a reason, in another form, or not right before an
element makes the command fail and write nothing. A marker that no longer ignores any
control raises nothing yet.

## Handing over a change

A change to the contract goes with the output of `bun run contract:diff main` in its
description, and below it, by hand, the reason for each rename or removal, since those break
whoever reads the old name:

```text
<the output of bun run contract:diff main>

Why:
- <each anchor, code, screen, entity or field renamed or removed>: <the reason>
Scenarios and tests changed with it: <scenario ids>
```

For example, renaming the revoke button of the devices page:

```text
contract changes: 1 anchor renamed
anchors renamed: device.list.revoke-button -> device.list.sign-out-button

Why:
- device.list.revoke-button: the button signs the device out, and the anchor now says so
Scenarios and tests changed with it: device/base/my-devices
```

The diff lists the screens, anchors, codes, entities and fields added and removed, and
takes an anchor removed and one added for a rename when they are the only ones of their
screen and kind. The tests are in this repository, so the same change updates them, and
the consumers check fails until it does.

## Asking for a missing anchor

When a scenario or a test needs an element the contract does not give it, the writer asks
for the contract change in this form:

```text
Anchor needed
Screen: <path> (<screen id>), role: <role>
Element: <what it is, in the words of the scenario>
Today: <no anchor | an anchor without this code | an anchor without this value | not in the contract>; the test finds it by <role, label or text>
Proposed: <anchor by the grammar> [+ data-code="<code>" | + data-value="<value>" | + data-state="<state>"]
In the tests: tests/e2e/src/<id>.e2e.spec.ts, scenario <id>
Why: without it the test depends on the wording or the layout and breaks when they change
```
