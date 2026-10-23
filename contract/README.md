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
   **Then the review.** The contract is committed first, a layer per commit and no
   implementation in either (the app's runtime of the contract and its specs are meta): the meta change when a facet is new (the engine: `@workspace/ui-contract`,
   the generated schemas, the vocabulary, this README), then the business change (the screen
   files, the activities, the platform, the model, the scenarios), the entry point of a
   feature. The change stops here: the developer reads the contract diff
   (`bun run contract:diff main`, the contract commits by hash with their diff, the reason
   for every change, the gaps signalled) and gives an OK on those commits or asks for changes
   to the contract. The OK covers those commits, and the last business commit of a rename
   or a removal that drops the old names the review listed. Any other contract commit made,
   re-cut, amended or rebased after it, even with its files unchanged, and a return to the
   implementation after other work, stop here again. The code and the tests,
   a test's scaffold included, start only after the OK, in commits of their own. A rename or a
   removal keeps the old name declared until the code no longer renders it, then a last
   business commit drops it, approved with the first, with no new stop; any other contract
   change found while writing the code is a commit of its own and goes back to step 1 and
   stops again. A fix that brings the code back to what the
   contract already says, correctly, has no contract diff and no stop.
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
  screen may run (signing up, in and out, organisations, devices), the events it raises
  in a flow (the local data opened, or could not be), the reserved anchors and the
  readiness line.
- `model.schema.json`: the data model, a JSON Schema 2020-12 document with one `$defs` entry
  per entity and the contract's `x-perch` keyword (table, region, id prefix, owner, rules,
  actions, how each field merges).
- `activities/<id>.yaml`: one activity across screens per file, named by its `id`
  (`activities/session.yaml`); the folder is optional (see "Activities").

Each YAML file opens with a comment that points an editor at its schema, so the editor
validates and completes it; the loader does not read the comment:

```yaml
# yaml-language-server: $schema=../screen.schema.json
```

`platform.yaml` points at `./platform.schema.json`, an activity at `../activity.schema.json`,
and a screen file one folder deeper points one folder further up.

Generated beside them, never edited by hand: `screen.schema.json` (one screen file),
`platform.schema.json` (the platform file), `activity.schema.json` (one activity file),
`x-perch.schema.json` (the `x-perch` keyword of the model) and `manifest.schema.json` (the
manifest). `bun run contract:schemas` writes them
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
every binding (`apps/web/src/platform/routes-router.spec.ts`, a parameter's first example
its sample), and the module routes equal the bindings (`routes-contract.spec.ts` beside it).

A parameter of `params` or `search` may carry `examples`: fake values it accepts, of its
type (`key: { type: string, examples: [ thg_01hzx9k2 ] }`); `contract:check` holds each one
to the parameter's schema. `bun run contract:routes` (`ui-contract routes [--json]`) prints
the routes of the screen files in four sections: the table (path, screen, guard, roles,
history, params, search, file), one example link per binding, where each route is reached
from (the anchors linking to it with `binding.route`, the screens whose flow navigates to
it, the activity states at that address) and the tree as the router holds it, `__root
(app-shell)` with each route under it, a route under the binding whose path is the longest
proper prefix of its own on whole segments. The example link is built from the binding:

- the path: each `$param` at its parameter's first example, else its `default`, else its
  first `enum` value, else a value built within its bounds and a `pattern` of a literal
  prefix and at most one repeated class (`^thg_[a-z0-9]+$` gives `thg_a`), the first of them
  not empty that the parameter's schema accepts; a parameter none of whose values can be
  built needs an example, and `contract:check` says so (`a path segment cannot be empty` for
  a schema that allows only the empty string); a `{-$param}` at its first example, or its
  segment left out without one; an empty example of a path parameter is a problem; a splat `$` left out with its segment (no parameter can
  be named `_splat`, so it takes no example); each value through `encodeURIComponent`;
- the search: every key in its declared order at its `default`, else its first `enum`
  value, else its first example, a key with none left out; written as TanStack Router's
  default `stringifySearch` writes it: a string bare unless it parses as JSON, then quoted
  (`"123"` is `%22123%22`), a number or a boolean as JSON, the whole form-encoded the way
  `URLSearchParams` encodes it (a space is `+`).

So a binding `/org/$org` whose `org` has `examples: [ org_01hzx9k2 ]` and whose `search` has
`view` (default `read`) and `page` (default `1`) has the example
`/org/org_01hzx9k2?view=read&page=1`. The example shows every search key with its default on
purpose; the app's own links leave out a value equal to its default, and both forms reach
the same state. The manifest carries the link as `example` on each binding, and
`apps/web/src/platform/routes-examples.spec.ts` holds every example to the real router (the
path it builds, the search string it writes, and the route, parameters and search it
matches for the link) and the router's route tree to the tree of the screen folder.

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

A screen's `states` say what is visible in each container state. The `wireframe` is the
default state in Playwright's aria snapshot grammar.

A screen's `flow` is an XState v5 machine config, in the subset `createMachine` takes as
written: the app carries it into `setup({ guards, actions, actors }).createMachine(flow)`
unchanged, as it carries a binding into the router.

- `initial` and `states`. A state has a `description`, `type: final` where the flow ends
  (the app has left the screen, or stops), `entry` and `exit` effects, `on` and `invoke`.
- A state of the root may be a parallel state, `type: parallel`, for the independent areas
  of a screen (the organisation page's create form, new note, notes' items, invitation and
  members): its `states` are its regions, two or more, all active at once. A region has a
  `description`, an `initial` and its `states`, plain states that never end, carry no
  `meta.address` (the address is the screen's state) and hold no states of their own. The
  parallel state has a `description`, `on`, `entry`, `exit` and `meta.address`, never an
  `initial` or an `invoke`; its own `on` applies whichever state each region is in. Entering
  it starts every region at its `initial`; leaving it leaves every region.
- `on` maps an event to one transition, or to a list of guarded ones in XState's order, the
  one without a guard last. An event is the user acting on a declared anchor (a derived one
  through its base's `derived`), or a platform event of `platform.yaml` `events`
  (`platform.opened`). A transition has a `target` (absent: the machine stays where it is),
  a `guard`, `actions` and a `description`. XState resolves a target from the parent of its
  state: at the root it is a state of the flow, or a state of a region as
  `<parallel>.<region>.<state>` (`viewing.create-form.open`: that region starts there, the
  others at their `initial`); in a region it is a state of that region, or a state of the
  root by the machine's id, `#<flow id>.<state>` (`#organisation.viewing`; the flow's `id` is
  a one-segment name the flow declares, which the app gives its machine), which leaves the
  parallel state and enters that state afresh, the parallel state itself with every region at
  its `initial`. Within a parallel state an event
  belongs to one area, one region or the state's own `on`, never two; the same event may
  appear in several states of one region.
- A guard is a camelCase name that the root `meta.guards` declares with what it holds
  (`holdsUnsentChanges: this device holds changes the server has not received`); the app
  implements it.
- The effects, in `actions`, `entry` and `exit`, are two: `{ type: show, params: { anchor,
  codes } }`, the anchor shows one of the codes it carries, and `{ type: navigate, params:
  { to, search } }`, the app moves to that binding. The app implements both.
- An `invoke` runs a model or a platform action while the machine is in its state: `src`
  names it as a binding does, `input` maps each parameter to the anchor whose value it
  takes or to a constant `{ value: ... }`, and `onDone` and `onError` say what follows its
  success and its failure. Every `input` key is a parameter of the action; a parameter left
  out is the implementation's to compute (a minted `$id`, the `author`). An event that runs
  an action is a transition into such a state, named for what it does (`signing-in`,
  `saving-name`, `inviting`).
- A state that a route reaches says so in `meta.address`: its `path`, a binding of the
  screen, and its `search`. The route owns the addressable state, what a link or a reload
  restores; the machine owns the transient one (signing in, confirming, failed). No state
  declares an address yet.

Nothing else of XState is in the subset: no `context`, `after`, `always`, states nested
deeper than a parallel state's regions, history states, targets by `.child` or by an id
from anywhere but a region's state, or actions named by a string. A state of a region is
the area's own: where the app keeps one per item (each note's edit form), the region follows
the item acted on last and says so.
The flow's states are the machine's; the screen's `states` stay the container states.
`contract:check` holds the flow to the contract, and
`apps/web/src/platform/flows-machine.spec.ts` runs every flow in XState: a pure walk with
`initialTransition` and `transition` reaches every state, a parallel state's regions each
on its own with the others at their `initial`, and takes every transition and every guarded
branch to its target with its effects, and an app's own machine for a screen
(`user.sign-in`) has the config of its flow.

## Activities

A screen file describes one screen, and a scenario one path through the app with its data
ready; an activity is the composition between them: which screens form one task, in which
order, and what the task carries from one screen to the next. Each one is a file,
`activities/<id>.yaml`, named by its `id`. The folder is optional, and a file that is not
`.yaml`, or one named otherwise than its id, is a problem of that file.

An activity has an `id` (kebab-case), a `title`, a `description` (what it is for), the
`roles` that take part and `data`: what it carries, by name, each with a `description` and,
when it is a field of the model, its `model` as `<entity>.<field>`. The rest is an XState v5
machine config in the subset of the flows, `initial`, `meta.guards` and `states`, where a
state is a visit to a screen:

- its name is dot-free kebab-case (`sign-in`, `profile`, `signed-out`): XState reads a dot in
  a target as a path into nested states, so a screen id is never a state's name, and one
  screen may be visited by several states;
- `meta.screen` names the screen, a screen id, and `meta.address` its `path`, the path of a
  binding of that screen: the activity is where its address is;
- `type: final` where the activity ends;
- `on` maps an anchor of that screen, or of the frame, to where acting on it leads: a
  `target` (the next visit), a `guard` (a name of `meta.guards`) and a `description`, or a
  list of guarded ones in XState's order.

An activity has no effects, no `invoke`, no `entry` or `exit`: it says where the task leads,
and the screens do the work. It goes into `setup({ guards }).createMachine(activity)` as
written, as the flows do. The file follows the layout of a screen file, with keys in the
order `id`, `title`, `description`, `roles`, `data`, `initial`, `meta`, `states`, and each
state's `meta` on one line. An excerpt of `activities/session.yaml`, the session of an
account from the sign-in page to the profile and the devices page and back to the sign-in
page:

```yaml
# yaml-language-server: $schema=../activity.schema.json
id: session
title: The session of an account
description: An account's session on this device, from the sign-in page to the profile and the devices page, and back to the sign-in page once the device signs out.
roles: [ guest, identity ]
data:
  account:
    description: The account signed in on this device, from the sign-in until the device signs out.
  profile.name:
    description: The name of the account, which the profile shows once it is signed in.
    model: profile.name
initial: sign-in
meta:
  guards:
    noUnsentChanges: this device holds no changes the server has not received
states:
  sign-in:
    description: The sign-in page, where a visitor signs in or creates an account.
    meta: { screen: user.sign-in, address: { path: /sign-in } }
    on:
      user.sign-in.submit-button:
        target: profile
        description: The account signs in, or is created in the mode sign-up, and the profile opens.
  profile:
    description: The profile of the account signed in.
    meta: { screen: user.profile, address: { path: /me } }
    on:
      app-shell.nav.devices-link:
        target: devices
      user.profile.sign-out-button:
        - target: signed-out
          guard: noUnsentChanges
          description: The device signs out at once; with changes not sent, user.profile.sign-out-dialog asks first and the profile stays.
  signed-out:
    description: The sign-in page again, once the device has signed out.
    type: final
    meta: { screen: user.sign-in, address: { path: /sign-in } }
```

The contract check holds an activity to the screens it visits. Every state's screen exists
and its address is a binding of that screen; every event is a declared anchor (a derived one
through its base's `derived`) of that screen or of the frame; and every transition from a
state on an anchor to a target is backed by the screens: the flow of the anchor's screen
(the frame's, for an anchor of the frame), from a transition on that anchor, reaches a
`navigate` to the target's path, in the transition's actions, on leaving its state or
entering its target (the `exit` and `entry` effects XState runs on a move) or after an
invoke's `onDone` or `onError`; or the anchor is a link to that path
(`binding: { route: ... }`). The roles are of the vocabulary and every `data` model is a field
of the model; `initial` and every target are states; every state is reachable from
`initial` and every state that is not final leaves; every guard is declared in `meta.guards`
and every declared one is used. `apps/web/src/platform/activities-machine.spec.ts` builds
each activity in XState as written, with the walk of the flows, reaches every state and
takes every transition and every guarded branch to its target.

A scenario that walks an activity names it in its front matter (`activity: session`, see
"Scenarios"), and the coverage note counts, per activity, the scenarios that name it and the
transitions they walk (see "Coverage").

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
- `activity`, when the scenario walks one: the id of an activity of `contract/activities/`
  (see "Activities");
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
  every path parses in the router's syntax, every example of a route parameter matches
  that parameter, and a `$param` without one has a value its schema accepts; every flow names states, events, guards,
  actions, anchors with their codes and bindings that exist, reaches each of its states
  and leaves each one that is not final; the versions agree; the generated schemas
  equal their Zod sources; every activity agrees with the screens it visits (see
  "Activities"); every bracket reference of a scenario resolves, the activity it names
  exists, and every device acts as a role of the vocabulary.
- `bun run contract:check:sources`: the JSX of `apps/web/src` and `packages/ui/src` against
  the contract. It reads the four literal forms and wants each literal written once, the
  literals equal to the anchors of the screen files (an anchor no source renders is a
  problem too), no literal equal to another plus a derived suffix, and every `testIdFor()`
  suffix and every code in the vocabulary. An anchor built at runtime is a problem. On a
  branch the pre-commit hook runs it as `contract:check:sources:ahead`, which lets the
  contract run ahead of the app (an anchor declared, not rendered yet, passes); a commit on
  `main` and `bun run check` take the full check. A rename or a removal keeps the old name
  declared until the implementation has switched to the new name or stopped rendering the
  removed element, then a last business commit drops it.
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
and the web app's tests hold the module routes and the real router to the bindings, and
XState and the app's machines to the flows.

## The manifest

`bun run contract:manifest` builds `ui-manifest/manifest.json` from the contract files and
the scenarios, only after the contract check passes, and validates it against
`manifest.schema.json` before it writes anything. The web build writes it into
`apps/web/dist/ui-manifest/` (the dev watcher into `apps/web/dist-dev/ui-manifest/`), and both
stands serve it at `/ui-manifest/manifest.json`, with
`manifest.schema.json` and `model.schema.json` beside it and `Cache-Control: no-store`.
`PERCH_UI_MANIFEST=0` on a stand answers 404 there.

It is what a tool outside the repository reads: the vocabulary as tables with prose
instructions for an agent, the screens (each binding with its `example` link), the platform
section and the activities verbatim,
the scenarios parsed, the route parameters, the model, and `ids`, every declared anchor with
its kind, its screen and its attributes, one entry per line, so a search for an anchor in
the manifest shows its facts.

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
   internal (an id, a creation time), so an unbound one is a question, not an error. Then
   per activity, the scenarios that name it in their `activity` and the transitions they
   walk: a transition from a state on an anchor is walked when one of those scenarios names
   the anchor in a step while that step's device is at the address of the state. Each
   device is at the most recent route its texts named, read in the order of the file
   (`where`, the steps and the expected results, each left to right), or at the initial
   state before it names one; a text that opens with `On device X` or `Device X:` belongs to
   device X, any other to the scenario's only device or to the device last named (`A` at
   first). The totals line adds `activities n, transitions walked x/y`.
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
the element alone. A marker without a reason, in another form, not right before an
element, or that ignores no control (its element, and for `ui-contract-ignore` everything
inside it, holds none) makes the command fail and write nothing.

## Handing over a change

This is the delivery of a finished change; the review before the code is described in "The
order of work". A change to the contract goes with the output of `bun run contract:diff main` in its
description (the screens, anchors, codes, entities, fields and activities added, removed or
renamed, and the transitions added or removed in each activity both sides hold), and below
it, by hand, the reason for each rename or removal, since those break whoever reads the old
name:

```text
<the output of bun run contract:diff main>

Why:
- <each anchor, code, screen, entity, field, activity or transition renamed or removed>: <the reason>
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
