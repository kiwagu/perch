# UI contract

This folder describes the web application as tests, agents and people see it: its screens,
the anchors on them, what each anchor is bound to, and the data model behind them. It is the
only input of the modeling thread: a screen is designed here first, and the code, the tests
and the database follow it.

## What is here

Three authored files, edited by hand (or by a model in the modeling thread):

- `vocabulary.md`: the closed lists of the contract, one table per section: the kinds of
  anchors, the derived suffixes, the attributes, the app, container and row states, the
  codes, the choice values, the screen names, the roles and the anchors the shell reserves.
  Its `Grammar` section says how an anchor is spelled.
- `screens.json`: the screens map and the anchor registry. Each screen has its routes
  (`bindings`), the anchors a test starts from (`entry`), every anchor it declares with
  its kind and binding, its states, its flow and a wireframe. The `platform` section lists
  the actions the platform offers every screen (signing in, organisations, devices), the
  reserved anchors and the readiness line. `scenarios` holds the end-to-end scenarios; a
  scenario's `devices` give each device the role it acts as by the end of the scenario (the
  role it reaches), and every device starts as `guest` unless a step signs it in.
- `model.schema.json`: the data model, a JSON Schema 2020-12 document with one entry of
  `$defs` per entity and the contract's `x-perch` keyword (table, region, id prefix, owner,
  rules, actions, how each field merges).

Beside them sit their schemas, generated from the Zod sources of `@workspace/ui-contract`
(never edited by hand; `bun run contract:schemas` writes them): `screens.schema.json` for
`screens.json`, `x-perch.schema.json` for the `x-perch` keyword of the model, and
`manifest.schema.json` for the manifest.

`COVERAGE.md` is a note, not a contract file: how many controls of each feature module carry
an anchor, and the anchors and scenarios of each screen, written by
`bun run contract:coverage --write` between its markers, with how it is counted.

The manifest, `ui-manifest/manifest.json`, is built from these three files only and served
at `/ui-manifest/manifest.json` on every stand. It is what a tool outside the repository
reads: the vocabulary as tables, the screens verbatim, every anchor with its screen, the
platform section, the scenarios and the model.

## Reading the screens map

A screen's `bindings` are its routes in the router's format: `path` (static segments,
`$param`, `{-$param}` for an optional one, `$` for a splat), `guard` (`guest`: only a
visitor; `authenticated`: only a signed-in account), the `roles` it serves, `params` and
`search` as flat JSON Schemas, `history` (`push` or `replace`) and `retain`. The frame
(`app-shell`, `frame: true`) has no route: it is around every screen.

A screen's `entry` lists the anchors a test starts from on the screen. Some of them are
alternatives by state, so a test waits for the one its state shows, never for all of them:

- `user.profile`: `user.profile.heading`, `user.profile.form` and `user.profile.save-button`
  once the profile is read (`ready`); until then, and when the account has no profile,
  `user.profile.status` shows instead (`loading`, `empty`).
- `organisation`: `organisation.page.status` without a membership (`empty`);
  `organisation.page.heading` and `organisation.notes.section` with a current organisation
  (the section in `loading`, `ready` or `empty`); `organisation.create.form` without a membership, or after its toggle.
- `device`: `device.page.status` while the devices are read (`loading`), `device.list` once
  they are (`ready`); `device.everywhere.open-button` in both.

An anchor's `binding` says what the element does or shows:

- `{ "model": "<entity>.<field>" }`: a field of `model.schema.json` (`$defs.<entity>`).
- `{ "action": "<entity>.<action>", "params": { ... } }`: an action of the entity's
  `x-perch.actions`; `{ "action": "platform.<name>" }`: an action of `platform.actions`.
  Each parameter names the anchor whose value it takes, or a constant `{ "value": true }`.
- `{ "route": "/path" }`: the path of a binding of some screen.

A list of bindings means the anchor runs them in that order, or one of them by the mode of
the screen; its `flow` says which. The other fields: `codes` (the `data-code` values the
element carries), `dataId` (what its `data-id` holds), `dataValue` (it, or its derived
options, carry a `data-value` from the choice values), `states` (its `data-state` values),
`derived` (the suffixes it renders), `roles` (who sees it; absent: every role of the screen),
`own` (a member sees it only on its own entries), `source` (where a list's entries come from).

A screen's `states` say what is visible in each container state; its `flow` lists its
states and, per event on an anchor, the action it runs and what follows (a route, codes, a
new state). The `wireframe` is the default state in Playwright's aria snapshot grammar.

## The anchor grammar

An anchor is the value of `data-testid`: 2 to 4 dot-separated kebab-case segments, the
screen name first (`user.sign-in`, `organisation`) and the kind last, as the last
dash-separated word of the last segment: `user.sign-in.email-input` is an `input` of the
sign-in screen, `organisation.notes.item` an `item` of the organisation screen. The kinds
are a closed list in the vocabulary, each with the Playwright role it maps to.

A derived anchor adds one suffix from the vocabulary for a part a composite renders itself:
`user.profile.sign-out-dialog.confirm-button`, `app-shell.locale-select.option`. Code builds
it with `testIdFor(anchor, suffix)` from `@workspace/ui-contract/anchors`. Every base anchor
is declared once, in one screen; an `item`, `row` or `option` marks every entry and tells
them apart by `data-id` or `data-value`.

## Locating an element

In this order, and stop at the first that works:

1. `getByTestId('<anchor>')`.
2. `getByRole('<role>')` without a name, inside the container found by its anchor.
3. `getByLabel(...)`.
4. `getByPlaceholder(...)`.

Text is used only for text the test itself entered (a note it wrote, an email it invited).

## Codes, not wording

The page speaks the user's language; tests and agents never assert its words. A
`message`, `error`, `toast` or `dialog` carries `data-code` with a code of the vocabulary,
and the test asserts the anchor and the code together. A choice that is not an entity
carries `data-value`; an entry that is an entity carries `data-id`.

## Readiness and container states

Wait for `app-shell.status` to reach the state `ready` (`[data-testid="app-shell.status"][data-state="ready"]`):
the frame and the screen are rendered. Its other states are `opening`, `failed` and
`storage-blocked`. Then wait for the screen's container to leave `loading`: a `list`, a
`section` or a page `status` carries `loading`, `ready`, `empty` or `error`.

## Notices

`app-shell.notice-message` shows one notice at a time, the latest, and it outlives the page
that raised it (the welcome after sign-up shows on the profile). Find it by its anchor and
its code together, right after the action that raises it.

## The anchors on a running page

On dev and e2e builds, `window.__perch.ui.anchors()` lists the anchors the page renders
now, so an agent sees what exists without reading code.

## Asking for a missing anchor

When a scenario needs an element that has no anchor, ask for one with:

- the screen;
- the role the scenario acts as;
- the element, as the user sees it;
- what exists today (a neighbouring anchor, a role, a label);
- the proposed name with its kind, following the grammar;
- where in the scenarios it is used;
- why the existing locators do not do.

## Handing over a change

A change to the contract goes with the output of `bun run contract:diff main` in its
description, so a reviewer sees which screens, anchors, codes and entities it adds, changes
or removes.

## How the checks keep code and contract equal

The contract check reads the three files, their schemas and their cross-references: every
anchor follows the grammar and is declared once, every kind, state, code, role and choice
value is in the vocabulary, every code of the vocabulary is used, every binding points at a
field, an action or a route that exists. Its sources mode scans the application for anchor
literals and fails when the code renders an anchor the contract does not declare, or the
contract declares one the code does not render. The coverage note reports, per screen, its
anchors and the scenarios that open it, and per feature module and for the UI kit, the controls
and how many of them carry an anchor.
