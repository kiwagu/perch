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

The contract is also where the architecture is decided. The developer programs it there,
apart from the implementation: the model, the screens with their flows, the platform, the
activities and the scenarios. The agent brings the patterns that make it good, proposed for
the developer's review with their trade-offs, and builds the code from the contract the
developer approved; the code takes no architectural decision of its own.

### The order of work

1. **The model.** A new field or action goes into its entity in `model.schema.json`
   (`properties`, `x-perch.actions`); an action of the platform goes into `platform.yaml`.
2. **The screen file.** The routes, the anchors that bind the field or the action, their
   codes, states and values, the `flow` and the `wireframe`. A word the vocabulary lacks is
   added to its table in the same change.
3. **The scenario.** The behaviour as a person would check it by hand, written from the
   contract alone, in `tests/e2e/scenarios/`.
   **Then the review.** The contract is committed first, a layer per commit and no
   implementation in either (the app's runtime of the contract and its specs are the
   implementation's). A
   new facet's meta change (the engine: `@workspace/ui-contract`, the generated schemas, the
   vocabulary's grammar, this README) goes on `feat/contract-first-pass`, after a merge of the latest
   `main` into it, and lands on `main` as its own squash after the developer's go on those
   meta commits by hash (one round at a time; a commit added after the hand-over needs a new
   one, and a change its review brings is a commit of its own on top, never an amend). The
   business change (the screen files, the activities, the platform, the model, the
   scenarios, the rows of the vocabulary's tables), the entry point of a feature, is then
   modelled on the contract trunk, `contract/trunk` (`.cursor/rules/branch-reuse-first.mdc`),
   with `main` merged in after that landing: the developer's modeling session, in the trunk's
   own worktree, commits it under the feature's card, each decision a commit of its own on
   top, never an amend; it may read the code, but writes none of it while it models, and the
   hook refuses a trunk commit that stages anything but the business layer ("The checks").
   The developer reads the contract diff (`bun run contract:diff main`, the commits by hash with
   their diff, the meta landing they build on, the reason for every change, the gaps
   signalled) and says when the card's contract is right: that is the OK, and the card names
   it with its trunk commits. The feature's own branch then takes the card as one business
   commit (`git cherry-pick --no-commit` of the card's commits, oldest first, then one
   `git commit` through the hooks, `<type>(contract): <the card's goal>` with the trailer
   `Taken-from: contract/trunk <first>^..<last> <card>`), and the code and the tests, a test's scaffold included,
   start on top of it, in commits of their own, which any session may write, the modeling
   one included: the contract and the code are never written at the same time, and the
   code never before its contract.
   The OK covers the card's commits, and the last business commit of a rename or a
   removal, written on the feature's branch, which drops the old names the card listed: a
   rename or a removal keeps the old name declared until the code no longer renders it, then
   that commit drops it, with no new stop. Any other contract change found while writing the
   code goes back to step 1 on the trunk and is taken as one more commit, a meta one through
   `feat/contract-first-pass` and its landing, after which `main` is merged into the trunk and
   into the feature branch. A business commit written on the feature's branch instead, a
   feature begun there before the trunk or an amendment the developer allows there, stops
   here for the developer's OK on its hash, as `.cursor/rules/ui-contract.mdc` says. A fix that
   brings the code back to what the contract already says, correctly, has no contract diff and
   no stop.
4. **The code.** The view renders exactly the anchors of the screen file, and
   `bun run contract:check:sources` holds it to them.
5. **The tests.** The test of the scenario uses the anchors, codes, states and values of the
   contract, and `bun run contract:check:consumers` holds it to them.

## The folder

```text
contract/
  README.md          this guide
  COVERAGE.md        the coverage note
  vocabulary.md      the closed lists
  domain/            what a feature describes: the model, the platform, the screens, the activities
  schemas/           the JSON Schemas generated from the tooling, never edited by hand
```

The authored files, edited by hand or by a model in the modeling thread:

- `vocabulary.md`, Markdown: the closed lists, one table per section (the kinds of anchors,
  the derived suffixes, the attributes, the app, container and row states, the codes, the
  choice values, the screen names, the roles, the anchors the shell reserves and the
  platform's composites). Its
  `Grammar` section says how an anchor is spelled. The loader reads each table by its fixed
  heading. The grammar, the kinds, the suffixes, the attributes and the contract version are
  the engine's (meta); every other table is content a feature adds with the screen file that
  first uses it (business).
- `domain/screens/<pathname>.yaml`: one screen per file, named by the path of the screen's
  first binding without the leading `/`. `/sign-in` is `domain/screens/sign-in.yaml` and `/me`
  is `domain/screens/me.yaml`; a nested path is a folder (`/org/$org` would be
  `domain/screens/org/$org.yaml`) and `/` would be `domain/screens/index.yaml`. The frame, the
  one screen without a binding, is `domain/screens/__root.yaml`, as in file-based routers. The screen's `id` (`user.profile`) is the
  prefix of its anchors, not its file name. The loader reads the folder sorted by path; a
  file that is not `.yaml`, or one named otherwise than its first binding says, is a problem
  of that file.
- `domain/platform.yaml`: the contract version, which equals the vocabulary's `Contract version`
  line and the tooling's `CONTRACT_VERSION`, and the platform section: the actions every
  screen may run (signing up, in and out, organisations, devices), the events it raises
  in a flow (the local data opened, or could not be), `leaving`, the actions whose run
  leaves what the user typed behind, `unsavedInput`, how every leave that would lose it asks
  first, `toasts`, the platform actions whose success toasts with their codes, `composites`,
  the lists with their items a screen derives by opting in (see "What a screen leaves out"),
  the reserved anchors and the readiness line.

  An action that sends a mail declares it under `mail`: `to`, the parameter whose value the
  mail goes to, or `account`, the email of the account the action acts on; `language`, the
  parameter that holds the mail's language, `account`, that account's settings once it has
  them, else the language it signed up in, or `recipient`, the account whose email the mail
  goes to, read the same way, and the signed-in account's when no account has that email (an
  invitation speaks the language of the account it invites, else the inviter's); `link`, the
  `screen` the mail's link opens and the `search` parameter of that screen's route that carries
  the link's token. `account` is a reserved word there: it names the account the action acts
  on, the signed-in account for an action on its own account (a change of email, a request to
  delete it), else, whoever is signed in, the one its parameters name: the email of the resend
  of a verification or of the request for a password reset, which send nothing to an email
  with no account, or the token of a link (a password reset, a confirmed email, a deletion). So
  an action that sends a mail has no parameter named `account`; nor one named `recipient`. The
  check holds `to` and `language` to the action's parameters, refuses a parameter named
  `account` on an action that sends a mail or a notice and one named `recipient` on an action
  that sends a mail, takes `recipient` only as the language of a mail whose `to` is a
  parameter, sent by an action whose `roles` leave `guest` out (it falls back on a signed-in
  account), and holds the link to a screen whose every route declares that search parameter.
  A scenario names the mail by its action, `[mail:sign-up]`, and a
  test that reads a mail holds it to its declaration: its recipient, the path and the search
  parameter of its link, and the language of its HTML.

  A mail that only tells is a notice, and an action declares the ones it sends under
  `notices`, a list. A `mail` carries a token the user acts on; a notice carries none, so
  nothing in it acts: a password changed, an email changed. Each notice has a `name`,
  kebab-case and unique within the action; `to` and `language`, as a mail's, where `account` is
  the account the action acts on, its email as it was before the action changed anything (a
  notice of a changed email goes to the old address); and, when it has one, a plain `link` to
  a `screen`, never with a `search`. A password-changed notice links to the reset of a
  password, for an owner who did not change it:

  ```yaml
  reset-password:
    # description, params, result, codes
    notices:
      - name: password-changed
        to: account
        language: account
        link: { screen: user.reset-password }
  ```

  `account` is reserved on an action that sends a notice too. The check holds `to` and
  `language` as a mail's, but for `recipient`, the language of a mail alone, wants the names
  unique within the action, and holds a link to a
  screen with a route, every route of which needs no parameter, as the link carries none (no
  `$param`, no splat, no required search key); the schema refuses a `search` on it. A scenario
  names a notice by its action and its name, `[notice:reset-password.password-changed]`.
- `domain/model.schema.json`: the data model, a JSON Schema 2020-12 document with one `$defs` entry
  per entity and the contract's `x-perch` keyword (table, region, id prefix, owner, rules,
  actions, how each field merges).
- `domain/activities/<id>.yaml`: one activity across screens per file, named by its `id`
  (`domain/activities/session.yaml`); the folder is optional (see "Activities").

Each YAML file opens with a comment that points an editor at its schema, so the editor
validates and completes it; the loader does not read the comment:

```yaml
# yaml-language-server: $schema=../../schemas/screen.schema.json
```

`domain/platform.yaml` points at `../schemas/platform.schema.json`, an activity at
`../../schemas/activity.schema.json`, and a screen file one folder deeper points one folder
further up.

Generated into `schemas/`, never edited by hand: `screen.schema.json` (one screen file),
`platform.schema.json` (the platform file), `activity.schema.json` (one activity file),
`x-perch.schema.json` (the `x-perch` keyword of the model) and `manifest.schema.json` (the
manifest). `bun run contract:schemas` writes them
from the Zod sources of `@workspace/ui-contract`, and the contract check fails when they
drift. `COVERAGE.md` is a note, not a contract file: `bun run contract:coverage --write`
rewrites its block, and `bun run contract:coverage:check` fails when the block is not what it
would write (see "Coverage").

The scenarios are part of the contract's input too, but they live in the e2e tree beside
their tests, in `tests/e2e/scenarios/` (see "Scenarios").

### Descriptions

Each domain file says in prose what its parts are for, in its `description`s: a screen's own
and each anchor's; a flow's own and each state's, region's and transition's, an outcome of an
invoke among them; a route parameter's; a platform action's, each of its parameters' and a
composite's; the model's own and each entity's, field's and action's; an activity's own and each
piece of its data's, each visit's and each transition's. Four maps hold descriptions without
the key: a screen's `states` (what is visible in each container state), the platform's `events`
(what each means), a composite's `items` (each the description of the item anchor a screen
derives from it) and the sentence guards of a `meta.guards` (a guard by failure code is
structure). A platform action's `result` is no description: it is the action's behaviour, which
the hand-over diff lists among the action's lines.

A description says what its element is for, as a tester or a user tells it apart, and leaves
out what the structure, another element, the platform, the model, the vocabulary or the flow
already says, and what the engine says itself (see "What a screen leaves out"). The purpose of
each field is the text its schema describes it with, which an editor shows as the field's hint:
what the field is for, what it leaves to others and its budget, in one text. Every written
description keeps at most 200 characters, whatever it describes, a screen's own included, and
`contract:check` names one past it by its place and its length, with the purpose of its field.
Written means as the file writes it: a description the engine derives, or that the loader fills
in as it expands a shorter form, is no file's and keeps no budget. `contract:diff` lists each
written description added, removed or changed by its place, with its length before and after
(`app-shell.theme-select 191 -> 340`, `new -> 120`, `340 -> gone`), a shrink included, so a
description that grows shows on review (see "Handing over a change").

### The layout of a screen file

The loader accepts any valid YAML. Files written by hand follow one layout, so they read
alike:

- keys in the order `id`, `title`, `description`, `frame` or `flag`, `bindings`, `entry`, then the rest;
- flow style, on one line, for `bindings` and each binding with everything it holds: its
  `roles`, `params`, `search`, `history` and `retain`, nested maps included (the test
  fixture `packages/ui-contract/src/__fixtures__/contract/domain/screens/sample/$key.yaml` has a
  binding whose `params` is a nested JSON Schema, still on one line);
- flow style for `entry`, and inside an anchor for its `roles`, `codes`, `states` and
  `derived` lists and for a `binding` that is one map with no map inside
  (`binding: { model: profile.name }`, `binding: { action: platform.sign-out }`);
- inside the `flow`, one line for what its shorter forms make short: a transition that is
  its target alone (`organisation.notes.delete-button: deleting`), an effect by its name
  (`- show: organisation.notes.error`, `- navigate: /me`), the codes of a `show` in flow
  style (`- show: { app-shell.notice-message: [ invited ] }`), and an `input` or an outcome
  that is one map with no map inside (`input: { id: organisation.notes.item }`);
- block style for the rest: the `anchors` map and each anchor in it, an anchor's `binding`
  that is a list or holds a map (its action's `params` included), the screen's `states`, the
  rest of its `flow`, a `source`, and the `wireframe` as a block scalar.

An excerpt of `domain/screens/me.yaml`:

```yaml
# yaml-language-server: $schema=../../schemas/screen.schema.json
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
    description: Saves the name, then the bio, each only when it changed.
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
the screen before it reads the anchors; never a list of its parts, which are its anchors, each
with a description of its own.

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

**Roles.** A role is a row of the vocabulary's Roles table. A device holds a set of roles:
`guest` when nobody is signed in on it, else `identity` and, beside it, every other role that
applies to the signed-in account (its role in the current organisation, `member` or `admin`;
a role of the platform; any role a later row adds). `guest` and `identity` are the two roles
of which a device holds exactly one; every other role is held beside `identity`, never alone.
The contract names the roles; how a device learns the ones beside `identity` is the app's.
`GUEST`, `IDENTITY`, `heldRoles` and `admits` of `@workspace/ui-contract/anchors` read them
for the app and the checks alike.

A binding's `roles` are the roles it serves: the router serves it only to an account that
holds at least one of them. An account that holds none gets the screen of the binding at `/$`
(the not-found screen) at the same address, as an address no route takes does: the URL and the
history entry stay as they are, and nothing on the page, the tab's title included, says there
is a route there. The router decides in this order: the binding's `guard` (`authenticated`
sends a guest to `/sign-in`, `guest` sends a signed-in account to `/me`), then its `roles`,
and only then reads the search, so a search the screen would refuse shows an account its roles
miss the not-found screen, never the screen's refusal. A route that must not show itself to a
guest leaves its `guard` out and names no `guest`: a guest gets not-found, as any account the
roles miss does. The binding at `/$` serves every account: its `roles` name `guest` and
`identity`.

The roles of a device change while a screen is open: an account signs in or out, another
organisation becomes the current one, a role is granted or taken back. The router decides
again when the app learns of it. A screen whose binding no longer serves the account is
replaced by the not-found screen and its state is dropped, as when another screen opens (a
read of its in flight is dropped with it); a not-found screen at an address whose binding now
serves the account is replaced by that screen, which opens as a screen opens (a list with a
platform source reads it, see `source`). An app that learns of a change late decides again
when it learns; no check sees the interval.

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
  parameter names the anchor whose value it takes, a constant `{ value: true }`, or
  `{ search: <name> }`: the value of that search parameter of the route the screen was opened
  at, which every binding of the screen declares under `search` (the token a link carries).
  An `item` or a `row` named as a parameter gives the `data-id` of the entry whose control
  acts: a control (a button, a link, a tab or a field, never a cell or a sibling entry) in the
  item's part (`<part>.<name>`, like the item), rendered in each entry
  (`device.list.revoke-button` passes `device: device.list.session-item`, the device of its
  own row). The item is an entry of a list, a table or a section of its own screen, declared
  under it or beside it in its part, and declares its `dataId`; an invoke's `input` takes one
  the same way, in a state that only the events of such controls enter.
- `{ route: /path }`: the path of a binding of some screen.
- `{ search: <name> }`, on a field (an input, a textarea, a select, a checkbox, a radio or a
  switch): the field starts with the value of that search parameter of the route the screen
  was opened at, takes it again each time that parameter becomes another, and the user may
  change it; every binding of the screen declares it under
  `search`. It sits in a list beside the action the field gives its value to: the email a
  link carried into `/forgot-password?email=...` fills the email input the request is sent
  with, `[ { search: email }, { action: platform.request-password-reset, params: { email:
  user.forgot-password.email-input } } ]`. A navigate of another screen's flow carries the
  value there (`{ anchor: <field> }`, below). A `secret` field never takes it: a secret is
  never filled from a URL.

A list of bindings means the anchor runs them in that order, or one of them by the mode of
the screen; its `flow` says which. The other fields of an anchor: `codes` (the `data-code`
values the element carries), `ranked` (`true` on a message whose `codes` are in rank order,
see "Notices"), `fields` (an error's codes, each with the field of its screen it
concerns: the error shows under that field and marks it invalid; a code left out concerns the
form; an error may leave both out, see "What a screen leaves out"), `dataId` (what its `data-id` holds), `dataValue` (it, or its
derived options, carry a `data-value` from the choice values), `states` (its `data-state`
values), `derived` (the suffixes it renders; a secret `input` alone may render
`visibility-button`, see "Anchors"), `roles` (who sees it, among the roles its screen's
bindings serve; absent: every role of the screen), `own` (a member sees it only on its own entries), `holdsInput` (whether a field keeps
what is typed; derived, see "What a screen leaves out"), `secret` (`true` on a field that
holds a secret: a password, its confirmation, a current password, anything that never leaves
the page but in the request of the action that takes it; only a field has it, no navigate
carries it into a search and no search parameter starts it), `composite` (on a secret input:
the composite of the platform it opts into, see "What a screen leaves out"), `source` (where a
list's entries come from, below). An anchor's `description` says what it is for; where the engine can
say it, the file leaves it out.

A `source` says where the entries of a list, a section or a table come from, and with it when
they are read; no other kind carries one. `{ platform: <action> }`: the entries are the answer
of that platform action, which the anchor reads each time it starts to render after it did
not: the screen opening, a state entered that renders it (`meta.renders`) after one that did
not, the account's role becoming one its `roles` admit; and, while it renders, each time the
organisation or account it reads for becomes another, or a search parameter its source takes
does (a `{ search: <name> }` of its `params`, and `page` and `size` when it is paged). The list
shows none of the entries of the earlier search once the search is another, and a read still in
flight when what it reads for becomes another is dropped: its answer is shown nowhere. A state
entered after another that rendered it too reads nothing, so an anchor no state lists, rendered
in every state, is read only at those moments. Every other read is said by the flow, with the
effect `read: <anchor>` (below, the effects of a flow): a read after an action that changed
what the list shows, never prose in a description. `{ entity: <entity>, order, direction }`:
the entries are the stored entries of that entity of the model, which the anchor follows as
they change, here or on another device; such a list is never read.

A platform source's `params` give the action's parameters their values: each a search parameter
of the route, `{ search: <name> }`, one every route of the screen declares, or a constant,
`{ value: ... }`; never a field, since what a list shows is a state of the address and what is
typed is not, so a search box moves the route with a navigate and the list reads the new
search. A parameter left out is the implementation's to compute, as in a binding.

`paged: true` makes the list a page of the action's entries. The action says it pages and
which page sizes it answers, `paged: { sizes: [ 10, 25, 50 ], default: 25 }` in `platform.yaml`
(each size once, the smallest first, the default one of them): it takes the number parameters
`page`, from 1, and `size`, one of the sizes, and answers the entries of that page, in the
order its `result` says, with the number of entries the other parameters find in all. The page
and the size are the route's search parameters `page`, an integer with a minimum of 1 and a
default of 1, and `size`, an integer whose `enum` is the action's sizes and whose default is
its default, which every route of the screen declares; the source takes them from there, so no
`params` names them, and a screen pages one list. A new search starts at page 1: a navigate
that sets a search parameter the list reads, or `size`, says `page: 1`.

A paged list derives four parts, which its `derived` lists and a screen file never writes.
`<list>.range`, once the read is in: the numbers of the first and the last entry of the page and
the number of entries in all (`51-100 of 312`), carried as `data-from`, `data-to` and
`data-total`, with `0` and `0` where the page holds no entry (`0 of 312`: a page past the last).
`<list>.previous-link`: a link to the same route, the same search and `page` one less, on every
page but the first. `<list>.next-link`: the same with `page` one more, on every page that does
not hold the last entry. `<list>.size-select`: a select of the page size, shown wherever the
list is, whose options (`<list>.size-select.option`) carry the action's sizes as `data-value`
and are the controls of `size`, which therefore writes no `x-perch` (the check derives them and
refuses one written); choosing one moves to the same route and search with that `size` and
page 1. A part leaves out
of the address a value equal to its default (page 1, the action's default size), as every link
of the app does. A range or a link that does not apply is absent from the page, never
disabled, so a state that lists the list in `meta.renders` does not require them; the size
select it does. `pagerOf`, `searchKeysOf` and `pageSearchOf` of `@workspace/ui-contract/anchors`
compute what a page shows, which search keys a list reads for and the search a part moves to,
for the app and the tests alike.

A screen's `states` say what is visible in each container state. The `wireframe` is the
default state in Playwright's aria snapshot grammar.

A screen's `flow` is an XState v5 machine config, in the subset `createMachine` takes as
written: `contract:check` runs it in `setup({ guards, actions, actors }).createMachine(flow)`,
with a stub per guard, effect and invoked actor, and an app that builds its own machine for the
screen holds it to the flow with the engine's comparison (`@workspace/ui-contract/machines`),
as it holds its router to the bindings.

- `initial` and `states`. A state has a `description`, `type: final` where the flow ends
  (the app has left the screen, or stops), `entry` and `exit` effects, `on` and `invoke`.
- A state of the root may be a parallel state, `type: parallel`, for the independent areas
  of a screen (the organisation page's create form, new note, notes' items, invitation and
  members): its `states` are its regions, two or more, all active at once. A region has a
  `description`, an `initial` and its `states`, plain states that never end, carry no
  `meta.address` (the address is the screen's state; their `meta` holds `renders` alone) and
  hold no states of their own. The parallel state has a `description`, `on`, `entry`, `exit`,
  `meta.address` and `meta.renders`, never an `initial` or an `invoke`; its own `on` applies
  whichever state each region is in. Entering it starts every region at its `initial`;
  leaving it leaves every region.
- `on` maps an event to one transition, or to a list of guarded ones in XState's order, the
  one without a guard last. An event is the user acting on a declared anchor (a derived one
  through its base's `derived`; typing, for a field), a platform event of `platform.yaml`
  `events` (`platform.opened`), or a data event `model.<entity>.<field>`: the stored value of
  a field that an anchor of the screen shows changed, here or on another device
  (`model.profile.name`). A transition has a `target` (absent: the machine stays where it is),
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
- A guard is a camelCase name that the root `meta.guards` declares with what it holds: a
  sentence (`holdsUnsentChanges: this device holds changes the server has not received`), or
  the failure codes it takes, `{ codes: [ <code>, ... ] }`, when it tells the failures of an
  action apart: it holds when the action failed with one of them. A guard by failure code
  guards only branches of an invoke's `onError` (a region written `by` its button included),
  and each of its codes is one the invoked action fails with, listed once; the sign-in screen
  may write `emailNotVerified: { codes: [ email-not-verified ] }` for the branch of
  `signing-in` that leads to `unverified`. A bare `show` on such a branch shows the guard's
  codes (see "What a screen leaves out"). An activity's guards are sentences. The app
  implements every guard.
- A control whose anchor is an event of the flow (a button, a select, a switch) is enabled
  exactly while a state the machine is in handles that event (`snapshot.can` in XState), and
  disabled otherwise: the profile's Save is disabled while it saves because neither
  `saving-name` nor `saving-bio` handles it. The app reads it from its machine and keeps no
  flag of its own. A password input's `visibility-button` is never an event of a flow, so
  the machine does not enable it: it is always enabled.
- The effects, in `actions`, `entry` and `exit`, are four: `{ type: show, params: { anchor,
  codes } }`, the anchor shows one of the codes it carries; `{ type: clear, params: { anchor
  } }`, an anchor that carries codes shows none until one is shown again; a field is emptied;
  `{ type: read, params: { anchor } }`, a list of the flow's own screen whose `source` is a
  platform action reads that action again; and `{ type: navigate, params: { to, search } }`,
  the app moves to that binding. The app
  implements all four. The codes come first: a `clear` of an anchor that carries codes,
  whatever its kind and its screen, a field included, means it shows none until one is shown
  again. A field that carries none (an input, a textarea, a select, a checkbox, a radio or a
  switch, a `secret` one included) is emptied, and only on the flow's own screen: it returns
  to its empty or initial value and holds no input any more, as if nothing was typed; a form
  empties its passwords this way once the action that took them succeeds. A `clear` never
  names a `visibility-button`, nor a button, a list, a link or any other anchor unless it
  carries codes. A `read` names a list, a section or a table the flow's own screen declares
  whose `source` is a platform action (see "Reading a screen file", `source`): it reads that
  action again and shows its entries once the read is in, and the app may take them from the
  answer of the action that just ran, when that action returns them (the devices page's
  sign-out of another device answers with the list). A `read` never names an anchor of
  another screen, one with no `source`, nor one whose source is an entity of the model, which
  follows the stored data as it changes and is never read. A read after an action is written
  on the outcome of its invoke (`onDone`, or an `onError` after which the list may have
  changed); an action that changes nothing a list of the screen shows says so on its invoke,
  `read: false`, and an invoke that says it and reads in one of its outcomes is refused. Each value of a navigate's `search` is a search key of the binding it moves to,
  given a literal (`$id` for a minted id) or `{ anchor: <field> }`: the value a field of the
  flow's own screen holds when the app moves (an input, a textarea, a select, a checkbox, a
  radio or a switch; never a button, a list, a `visibility-button` or a `secret` field, whose
  value would stay in the address, the browser's history and the logs). A link that carries
  the email typed so far to the page that asks for a password reset:
  `navigate: { to: /forgot-password, search: { email: { anchor: user.sign-in.email-input } } }`.
  A value may also be `{ item: <item> }`: the `data-id` of the entry of that `item` or `row`
  whose control the user acted on, so that the selection is in the address and a reload or a
  copied link reaches the same entry. Only the event of a control (a button, a link, a tab or
  a field, never a cell or a sibling entry) in the item's part (`<part>.<name>`, like the
  item), rendered in each entry, carries it, so the navigate sits
  in the actions of that event's transition, never in an `entry`, an `exit` or the outcome of
  an invoke, where no entry was acted on. The item is an entry of a list, a table or a section
  of the flow's own screen, declared under it or beside it in its part, and declares its
  `dataId`; the search key it fills takes a string. A row that opens the entity it shows:
  `navigate: { to: /<path>, search: { id: { item: <screen>.list.<entity>-item } } }` on
  `<screen>.list.open-link`.
- An `invoke` runs a model or a platform action while the machine is in its state: `src`
  names it as a binding does, `input` maps each parameter as a binding's `params` do: to the
  anchor whose value it takes, a constant `{ value: ... }`, or a search parameter of the route
  `{ search: <name> }`, and `onDone` and `onError` say what follows its
  success and its failure. Every `input` key is a parameter of the action; a parameter left
  out is the implementation's to compute (a minted `$id`, the `author`). An invoke may say
  `read: false`: its action changes nothing a list of the screen shows, so nothing reads after
  it (the copy of an invitation link); XState ignores the key, the checks and `contract:diff`
  read it, and the machine comparison leaves it out. An event that runs
  an action is a transition into such a state, named for what it does (`signing-in`,
  `saving-name`, `deleting`), or `running` in the region of a button.
- A state that a route reaches says so in `meta.address`: its `path`, a binding of the
  screen, and its `search`. The route owns the addressable state, what a link or a reload
  restores; the machine owns the transient one (signing in, confirming, failed). One
  transient state is exempt and no flow holds it: whether a password input shows what it
  holds, which the input keeps itself and its `visibility-button` toggles (see "Anchors").
  No state declares an address yet.
- An anchor that only some states render, those states list in `meta.renders`: a plain
  state of the root, a parallel state or a state of a region. An anchor no state of the flow
  lists is rendered in every state. An anchor a state lists is rendered only where it is
  listed: in a plain state of the root that lists it, and in a state of a region that lists it
  or whose parallel state does. A name is an anchor its screen declares, listed once; a
  derived part is rendered with its base, so a state lists the base
  (`user.sign-in.password-input`, never its `visibility-button`). A listed anchor also
  renders the anchors declared under it (`<anchor>.<rest>`, as a scenario's codes and states
  speak of them): `user.sign-in.password-rule-list` brings the six items of the composite with
  it, so a state lists the list alone, never the list and one of its items in one list, and an
  anchor declared under a listed one is rendered only where its container is, or where a
  state lists it itself. A plain state of the root or a state of a region that handles an
  event on an anchor only some states render renders that anchor (for an event on a derived
  part or on an anchor declared under another, through the anchor it is under), since a
  control the user acts on is on the page; a state may render a control it does not handle,
  which is then disabled. The events of a parallel state's own `on` are not held to this, and
  neither are the effects: a `show` or a `clear` may name an anchor its state does not render.
  The states of a region written by its pattern or by its button, or derived by the loader,
  list nothing: an area that renders something in some of its states only is written in full.
  For the modes of the sign-in screen (the rest of its flow left out):

  ```yaml
  flow:
    initial: sign-in
    states:
      sign-in:
        meta:
          renders: [ user.sign-in.forgot-link ]
      sign-up:
        meta:
          renders: [ user.sign-in.password-rule-list, user.sign-in.password-confirmation-input, user.sign-in.name-input ]
      check-mail:
        meta:
          renders: [ user.sign-in.forgot-link, user.sign-in.resend-button ]
      # signing-in as sign-in; password-weak, passwords-differ and signing-up as sign-up;
      # unverified and resending as check-mail
  ```

  The form, the email and password inputs and the submit and toggle buttons are listed by no
  state, so every state renders them; the forgot link is rendered only in the states that
  list it, and the password rule list with its items only in the states of the mode sign-up.
  `passwords-differ` handles `user.sign-in.password-confirmation-input`; without its list,
  `contract:check` would say `"user.sign-in.password-confirmation-input" is handled here but
  not rendered: only the states that list it in meta.renders render it`. A state that runs an
  action lists what stays on the page while it runs: `signing-up` lists the rule list, the
  confirmation and the name input, or they would go while the account is created.
  `contract:diff` lists each entry as a line `<state path> renders <anchor>`.

  Rendered means visible to the user. An anchor a state renders is on the page and seen; one
  it does not render is not seen: absent from the page, or kept in it hidden (`hidden`,
  `display: none` or `visibility: hidden`, as the page helper's `visible` reads it), as a form
  that keeps what was typed into it while it is closed. The app reads what a state renders
  from its machine, whose states carry the flow's `meta.renders`, through the engine's
  `renderedAt` and `isRendered` (`@workspace/ui-contract/anchors`), never from a flag of its
  own, as it reads which controls are enabled; the engine's comparison holds those lists to
  the flow's (below), and an e2e run holds the page to them in every state a test passes
  through (see "The manifest").

A screen file may write its flow shorter, and leave out what the contract says elsewhere
(below); the loader expands it into the config above before anything reads it, so the
checks, the walk in XState, the manifest and an app's machine see the full config, and `bun
run contract:flow <screen>` prints it. The shorter forms are four:

- A transition written as its target alone, as XState itself allows: `onDone: idle` is
  `onDone: { target: idle }`.
- An effect written by its name: `show: <anchor>`, the anchor shows one of the codes it
  carries, in its order (in the `onError` of an invoke, one of the codes the failure of its
  action shows, narrowed by a guard by failure code; see "What a screen leaves out"); `show:
  { <anchor>: [codes] }`, one of these; `clear: <anchor>`; `read: <anchor>`; `navigate:
  <path>` or `navigate: { to, search }`.
- A region written by its pattern, a shape that two regions or more of the screens share,
  named by what the area does. A shape that one region has is written in full until a
  second one shares it.
  - `draft`: a control that follows a stored value or holds what was typed. In `following`
    the control `input` shows the stored value as it changes, here or on another device;
    typing moves it to `edited`, which goes back to `following` when what was typed is the
    stored value again, by typing it back or by the data event `stored`, both under `guard`.
- A region written by its button, `by: <button>`: the region of a button bound to one action
  (below) with what the screen decides of it, its `description`, `onDone` and `onError`, and
  the `toast: false` or `read: false` it says of its action, which the loader puts on the
  region's invoke. An
  outcome left out is the derived one; a transition without a target goes back to `idle`.

The states of a pattern and of a button's region are the machine's, named by the loader
(`idle`, `running`, `following`, `edited`), and a scenario or a test reads them as it reads
any state. What the shorter forms leave out is mechanics a tester or a user cannot tell
apart; a `description` belongs to a decision (where a success leads, what a failure shows,
what restarts what), not to every state.

Nothing else of XState is in the subset: no `context`, `after`, `always`, states nested
deeper than a parallel state's regions, history states, targets by `.child` or by an id
from anywhere but a region's state, or actions named by a string. A state of a region is
the area's own: where the app keeps one per item (each note's edit form), the region follows
the item acted on last and says so.
The flow's states are the machine's; the screen's `states` stay the container states.
`contract:check` holds the flow to the contract and runs it in XState (the engine's
`machines/walk`): a pure walk with `initialTransition` and `transition` reaches every state,
a parallel state's regions each on its own with the others at their `initial`, and takes
every transition and every guarded branch to its target with its effects. An app that
builds its own machine for a screen holds it to the flow with the engine's comparison
(`@workspace/ui-contract/machines`; the web app's `apps/web/src/platform/machines.spec.ts`):
the machine has the config of its flow, what each state renders included (on a branch, the
flow less what it added and the machine has not built yet), an invoke's `read: false` aside,
which is a promise the checks read and nothing a machine runs.

### What a screen leaves out

What a screen would only repeat of the model, the platform and its own bindings, it leaves
out, and the loader derives it, the same way every time:

- **What an action fails with.** A platform action fails with the codes `platform.yaml`
  declares for it. An action of the model fails with `forbidden` first when its entity says
  who may change it (`x-perch.can`), then with the codes of the fields its parameters set,
  then with `failed`. A field gives, from its JSON Schema: `<field>-required` for a
  `minLength` of 1, `<field>-too-short` for a larger one, `<field>-too-long` for a
  `maxLength`, `<field>-invalid` for a `pattern` or a `format`, and `<field>-taken` when the
  field alone is unique (`x-perch.unique`); a new id and a read-only field give none, and a
  field's name is kebab-case in a code. So `note.createNote` fails with `forbidden`,
  `text-required`, `text-too-long` and `failed`, and a `maxLength` added to a field adds its
  code wherever an action sets the field.
- **A button's params.** A `button` whose binding names an action gets, for that action, every
  param the fields of its part (`<part>.<name>`: an input, a textarea, a select, a checkbox, a
  radio or a switch) pass in their own bindings of it. The email and password inputs of
  `user.sign-in` pass `email` and `password` to `platform.sign-in`, so
  `user.sign-in.submit-button` binds it as `action: platform.sign-in` alone. A param the button
  writes wins, key by key, so a value no field of its part passes stays written: its binding of
  `platform.sign-up` keeps `locale: app-shell.locale-select`, an anchor of the frame. Two fields
  that pass one param with different values are a problem of the button until it writes that
  param.
- **An error's codes and fields.** An error `<part>.error` that writes no `codes` carries the
  codes of three sources, each once, `failed` last: the failures of the actions the anchors of
  its part bind (`<part>.<name>`, in the order they are declared); then the failures of the
  actions the flow invokes and shows on it, by a written `onError` in any form or by the
  request pattern below, a region written `by` a button included; then the codes the flow
  shows on it explicitly, `show: { <error>: [codes] }` in an `entry`, an `exit` or a
  transition. So `user.reset-password.error` may leave its codes out: the failures of
  `platform.reset-password`, which the anchors beside it bind, then `passwords-differ`, which
  its flow shows on it, then `failed`. One that writes no `fields` maps each code of a field to
  the control its binding or the invoke passes for that field (`name-too-long` to
  `user.profile.name-input`), when that control is a field of the screen; a code that two
  sources pass from two controls concerns the form. What the file writes wins.
- **Whether a field holds input.** Every field (`input`, `textarea`, `select`, `checkbox`,
  `radio`, `switch`) holds input: what is typed into it stays until an action takes it or a
  `clear` of its flow empties it, so a leave with it typed loses it, and the app is to ask
  before such a leave. A field one of whose bindings runs an action that takes the field
  itself as a parameter, an action no other anchor of its screen runs with it (the language
  select, the organisation select), applies at once and holds none; a field whose action a
  submit button also runs with it (the sign-in email) holds input. The loader sets
  `holdsInput` on every field; a written value wins. The manifest carries it, and
  `contract:diff` lists the fields that start or stop holding input.
- **Which leaves ask first.** `platform.yaml` declares under `unsavedInput` every leave that
  would lose what was typed, and how the app asks first. `question` names the frame's dialog:
  a reserved dialog whose code names what it asks, its confirm-button lets the leave go on and
  its cancel-button stays; it runs no action of its own. `screen` (a link, Back, Forward) and
  `actions` (a control bound to an action listed under `leaving`, such as a sign-out) ask
  through it (`question`) or `never`. `unload` (a reload, closing the tab, an address typed by
  hand) is the browser's own prompt (`browser`), drawn outside the page, so no anchor or code
  marks it, or `never`. `state` (a tab, a search parameter inside one screen) is `never` or
  `question`; `flow` (a navigation a flow makes after its action completed: the action took
  the input) is always `never`, and `elsewhere` (another tab or device, a database that will
  not open) always `cannot`. The manifest carries it, and `contract:diff` lists a change of
  it.
- **What a failure shows.** In the `onError` of an invoke, `show: <anchor>` shows one of the
  codes the failure of the invoked action shows. In an `onError` list with a branch guarded
  by failure code, a bare `show` on that branch shows the guard's codes, and one on a later
  branch, unguarded or guarded by a sentence, the failure's codes but those the branches
  guarded by code before it take; a branch before the first one guarded by code shows the
  whole failure, and a `show` that names its codes keeps them. So where the state
  `signing-in` of `user.sign-in` writes `show: user.sign-in.error` on both of its branches,
  with `emailNotVerified: { codes: [ email-not-verified ] }`, the first shows
  `email-not-verified` and the second `invalid-credentials`, `rate-limited`, `other-account`
  and `failed`; a screen may write the codes out instead, and what it writes wins. The error's
  own codes are not narrowed: it carries every code of the failure, whichever branch shows it.
  A bare `show` after branches guarded by code that take every code of the failure is
  refused: that branch names the codes it shows.
- **The outcome of a request.** An invoke whose action fails with codes and that writes no
  `onError` follows the pattern of a request: entering its state clears the error its failure
  shows on (unless the state's `entry` clears it already), and a failure goes back the one way
  it came, showing its codes on that error. The way back is the one sibling state whose
  transitions on controls enter the invoking state: only a control makes one, so a state a
  platform event or a data event enters has none. The error is `<part>.error` of the part
  those controls sit in (of the fields the invoke's `input` names, when no control enters it),
  else `<screen>.error`; with no part at all, no control entering it and its `input` naming no
  field (a request a link starts, its input a search parameter), it is `<screen>.error`. So
  the state `changing` of `user.settings` may leave out its `entry`
  and its `onError`: the loader clears `user.settings.password.error` on entry and adds the
  `onError` back to `kept`, the one state whose `user.settings.password.save-button` enters it,
  showing the failure of `platform.change-password` on that error. An `onError` written as its
  target alone (a `description` beside it changes nothing) keeps that target and still gets the
  show, with no clear on entry; one with actions, or a guarded list (the state `resetting` of
  `user.reset-password`), is written in full and wins. A state with no single way back writes
  its `onError`, and the check names the reason when it does not: one where its flow or its
  region starts (even when a sibling enters it too), one two states enter, one an invoke's
  outcome enters, one a platform event or a data event enters, one entered from outside its
  area. So does a state whose failure finds no error, its target alone written or not. A state
  with no way back may write its `onError` as its target alone, which still gets the show: a
  request a link starts where its flow starts writes `onError: <state>`, and its failure shows
  on `<screen>.error`. An action that fails with no code gets nothing.
- **The region of a button.** A button bound to one action that no state of the flow
  handles gets its region, when the root of the flow has one parallel state. The region is
  named by the button without its screen and its kind (`organisation.notes.add-button` gives
  `notes-add`) and comes after the regions written; it counts among the two regions or more of
  the parallel state, which may write fewer. It rests in `idle`; the button moves it
  to `running`, which invokes the action with the parameters the binding passes, and both
  outcomes lead back to `idle`. A failure shows its codes on the error of the button's part;
  the success of an action of the model says what the controls do by the word its name
  starts with: `create` (`createNote`), the controls whose values it took are emptied;
  `update`, they show the stored value; `delete`, the entry leaves its list. A failure with
  codes and no error in
  the part is a problem: the screen declares the error, or writes the region by its button
  with its `onError`.
- **The toast of a success.** With a toast anchor on the frame (`app-shell.toast`), every
  mutation says its success there, with a standard message: each invoke of an action of the
  model, written or in a derived region, gets on each branch of its `onDone`
  `show: { app-shell.toast: [<code>] }`, the code being the action's object in kebab case and
  the past of its verb (`note.createNote` gives `note-created`, `profile.updateBio` gives
  `bio-updated`), or `<action>-done` for a verb other than create, update and delete; a
  platform action toasts when `platform.yaml` lists it under `toasts`, with the code listed
  (`organisations.create: organisation-created`), and an unlisted one never does. The toast
  says an operation's outcome once, where it ends: an operation starts with an event that
  enters a state running such an action and goes on along the branches of its `onDone` that
  enter another (one Save running `updateName`, then `updateBio`); such a step toasts nothing,
  and a branch that targets its own state re-enters nothing. An operation of one action says
  that action's code; one of several says the operation, `<object>-<verb>ed` from the control
  whose event starts it: the verb is the control's name without its kind, in the past
  (`save-button` gives `saved`), the object the part the control sits in, or the screen's last
  segment for a control of the screen itself (`user.profile.save-button` gives
  `profile-saved`). An operation of several that no control starts (a platform event), or that
  controls with different codes start, is refused until the screen writes its own message on
  the toast or bans it; so is one event that starts several such operations at once (the
  regions of a parallel state it enters, or two regions handling one press with transitions
  that stay in them), until the screen writes `toast: false` on every action of all but one.
  One press gives one toast. The
  toast stays on unless the screen says otherwise: a branch of the `onDone` that shows its own
  message on the toast keeps it (a written message wins on its anchor, branch by branch; the
  other branches still get the standard one), and the one ban is `toast: false` on
  the invoke, or on a region written `by` its button (the language select's store: the change
  is visible by itself); a notice or an error written on the outcome says nothing about the
  toast. `read: false` sits beside it on the same invoke or region, a different statement:
  the action changes nothing a list of the screen shows, so nothing reads after it (see
  the effects of a flow, `read`). A failure never toasts: it shows on the part's error. The toast anchor carries every
  code a flow shows on it; the vocabulary documents the derived ones by one rule row,
  `<object>-<verb>ed`, the manifest lists each with its action, and `contract:diff` reports a
  new one. A code a flow writes on the toast
  itself (a warning of its own), or the frame lists on it, has its own row, even where a
  derivation gives the same code.
- **The question before a destructive action.** With a confirmation on the frame (an anchor of
  kind `confirmation`, `app-shell.confirmation`), every control whose binding names a
  destructive action asks it before the action runs: an action of the model whose verb is
  `delete`, an action of the platform whose verb (the first word of its last segment) is
  `ban`, `delete`, `remove` or `revoke`. The manifest writes it on the control, `asks: { dialog,
  code }`, the code `<object>-<verb>` for the model (`note.deleteNote` gives `note-delete`) or
  the platform action's name with `.` as `-` (`organisations.remove` gives
  `organisations-remove`); the confirmation carries every code asked with, which the
  vocabulary documents by one rule row, `<object>-<verb>`. Both are derived only: a screen file
  never writes `asks`, nor the frame the confirmation's codes. The flow says nothing of it: the
  press still leads to the state that runs the action, and the app's gate asks in front of the
  event, its confirm-button letting the event through and its cancel-button dropping it. The
  one line a screen writes is `confirm: false` on the control, which runs the action without
  asking; on a control that runs no destructive action it bans nothing and is refused. Without
  a confirmation on the frame nothing asks.
- **A composite of the platform.** A list with its items that several screens show, where the
  policy behind it lives in the platform, is declared once in `platform.yaml` under
  `composites`: its `description`, its `list` (the last segment of the list, ending in
  `-list`), its `itemState` (a row state each item takes once what it says holds) and its
  `items`, each by name with its description. A secret input opts in with `composite: <name>`,
  and the loader declares on its screen `<screen>.<list>` (kind `list`, the composite's
  description) and `<screen>.<list>.<item>-item` (kind `item`, the item's description,
  `states: [ <itemState> ]`), right after the input, each marked `derivedFrom`. The rules a new password
  keeps, which `user.sign-in`, `user.reset-password` and `user.settings` each show under their
  new password, in `domain/platform.yaml`:

  ```yaml
  composites:
    password-rules:
      description: The rules a new password keeps, each marked once the password typed keeps it.
      list: password-rule-list
      itemState: met
      items:
        length: 10 to 35 characters.
        digit: At least one digit.
  ```

  The new password of `domain/screens/reset-password.yaml` opts in, and its screen gets
  `user.reset-password.password-rule-list`, `user.reset-password.password-rule-list.length-item`
  and `user.reset-password.password-rule-list.digit-item`, none of them written:

  ```yaml
  user.reset-password.password-input:
    kind: input
    secret: true
    composite: password-rules
    binding:
      action: platform.reset-password
      params:
        password: user.reset-password.password-input
    derived: [ visibility-button ]
  ```

  The derived list and items are declared anchors like any other: the flow's guards, the
  scenarios, the tests and the sources name them as they name any. An unknown composite, an
  opt-in on anything but a secret input, a second opt-in of one composite on a screen, a
  written anchor whose id a composite derives, two composites deriving one anchor and a
  `derivedFrom` a screen file writes are problems. The vocabulary's "Composites" table names
  each composite with what it is for; the manifest lists them in `contract.composites`, the
  declarations under `platform.composites`, and `contract:diff` reports a composite added or
  removed. A composite declared and used by no screen is no problem: `contract:coverage`
  notes it (`composite <name> is declared and used by no screen`).
- **A description the engine can say.** An anchor's `description` may be left out where the
  engine says it: a `heading` names its screen by its title; a `link` whose one binding is a
  route to a screen's path leads to that screen; a secret `input` holds a secret the user
  types and never shows; an `error` says why the actions bound beside it, then those its flow
  invokes against it, did not go through,
  each of its codes with its meaning from the vocabulary's "Codes" table, the one place a
  code's meaning lives; and a composite's anchors carry the platform's descriptions. The
  manifest carries the written description, a secret input's with `(type password)` appended
  once, else the derived one, and gives each derived part in `contract.derivedParts` the
  meaning of its suffix. `bun run contract:coverage --descriptions` lists the written
  descriptions the engine would say itself, for the developer to drop.

What stays in a screen is what a tester or a user can tell apart: the areas and their
states, where each control leads, a success or a failure that goes elsewhere than the derived
one or shows something else, guards, confirmations and chains of actions. `bun run
contract:diff <ref>` lists the codes and the error fields the anchors gain or lose, written or
derived, so a constraint added to the model shows on review as the codes it adds, and the lines
of each screen's flow, its states' addresses, what they render and what each guard by failure
code takes among them, and every line of a flow added to or removed from a screen,
descriptions aside, so a screen written shorter that loads to the same flow shows no change
but the descriptions it stops writing, each listed as `<n> -> gone`.

## Activities

A screen file describes one screen, and a scenario one path through the app with its data
ready; an activity is the composition between them: which screens form one task, in which
order, and what the task carries from one screen to the next. Each one is a file,
`domain/activities/<id>.yaml`, named by its `id`. The folder is optional, and a file that is not
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
and the screens do the work. `contract:check` runs it in
`setup({ guards }).createMachine(activity)` as written, as it runs the flows. The file follows the layout of a screen file, with keys in the
order `id`, `title`, `description`, `roles`, `data`, `initial`, `meta`, `states`, and each
state's `meta` on one line. An excerpt of `domain/activities/session.yaml`, the session of an
account from the sign-in page to the profile and the devices page and back to the sign-in
page:

```yaml
# yaml-language-server: $schema=../../schemas/activity.schema.json
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
        description: The account signs in, and the profile opens.
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
and every declared one is used. `contract:check` builds each activity in XState as
written, with the walk of the flows, reaches every state and takes every transition and
every guarded branch to its target.

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

One derived part is presentation only: `visibility-button`, the eye a password input renders
beside itself, which shows what the input holds as typed or hides it again. The input
declares it, `derived: [ visibility-button ]`, and only a secret `input` may (`secret: true`):
on any other field there is nothing hidden for it to show. Its `data-value`
names what a click does: `show` while the input hides its value, `hide` while it shows it;
the two values are the suffix's own, never rows of "Choice values". Whether the field shows
its value is held by the field itself, the one transient state a flow never holds, so the
button is never an event of a flow or an activity, it is not one of the controls the machine
enables, it is always enabled, and it holds no input, so no binding's `params` and no invoke's
`input` takes it (`contract:check` refuses each of these). A test
locates it as `<input>.visibility-button` and asserts `show` or `hide` on it; the manifest
lists it in `contract.derivedParts` with its kind and its values.

Four derived parts belong to a paged list (see "Reading a screen file", `source`): `range`,
`previous-link`, `next-link` and `size-select`. The loader lists them in the `derived` of the
list whose source says `paged: true`, and a screen file never writes them. The options of the
size select, `<list>.size-select.option`, carry the action's page sizes as `data-value`, the
values of the action and never rows of "Choice values", and choose the route's `size`: the
check knows them, so the binding writes no `x-perch` on `size`.

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
  fixed value is a row of "Choice values" with its meaning. On a `visibility-button` it is
  `show` or `hide`, the values of its suffix; on an option of a paged list's `size-select`, the
  page size it chooses.
- `data-from`, `data-to` and `data-total` on the `range` of a paged list: the first and the
  last entry the page shows, from 1 (`0` and `0` when it shows none), and how many the search
  finds in all.
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
rendered. Its other states, and what each means, are the vocabulary's table "App states".
Then wait for the screen's container to leave `loading`: a `list`, a `section` or a page
`status` carries one of the vocabulary's "Container states".

## Notices

`app-shell.notice-message` shows one notice at a time, the latest, and it outlives the page
that raised it (a notice an action raises just before its flow navigates shows on the page it
navigates to). Find it by its anchor and its code together, right after the action that
raises it.

A message whose codes more than one source may raise before it shows (an effect of the app
and a `show` of a flow on its way there) says which one it shows in its structure:
`ranked: true`, with its `codes` in rank order. Of the codes raised before it shows, it shows
the first, and the others go with it. A code raised waits until the message shows or a flow
clears it: a `clear` of the message, in any flow, takes away every code raised before it.
`contract:check` takes `ranked` on a message of two codes or more, each listed once, and
`contract:diff` lists each ranked message with its order (see "Handing over a change").

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
- `activity`, when the scenario walks one: the id of an activity of `contract/domain/activities/`
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
path of a binding), `[code:<code>]`, `[state:<state>]`, `[value:<value>]` and
`[mail:<action>]` (a platform action that declares the mail it sends) and
`[notice:<action>.<name>]` (a notice of that name the platform action declares).

In one text (the `Where` line, the scenario sentence, a step or an expected result), a
`[code:…]`, a `[state:…]` or a `[value:…]` speaks of the anchor the text names last before
it, and the check wants it to be one that anchor carries: a code of its codes, written or derived,
a state of its `states`, a value of its choice values, its own or those of an anchor declared
under it (`<anchor>.<rest>`: the items of a composite's list, the options of a select, the
eye of an input). So `[user.sign-in.mail-message] carries [code:check-your-mail]` holds, and
`every item of [user.sign-in.password-rule-list] carries [state:met]` holds through the
list's items, while `[user.confirm-email.error] carries [code:welcome]` is a problem,
`user.confirm-email.error never carries code welcome`. A route is read past: in `wait for
[app-shell.status] to reach [state:ready] on [/me]` the state is the status's. A
`[mail:…]` or a `[notice:…]` ends the pairing until the text names an anchor again, since
what follows speaks of the mail or the notice (its language, its link). With no anchor before
it in its text, a code, a state or a value need only be one of the contract. Write the anchor
first, then its code, its state or its value: a value written before its anchor pairs with an
anchor the text named earlier, if any. `Choose [value:dark] in [user.settings.theme-select]`
holds the value to the contract alone, and `[user.settings.theme-select] shows [value:dark]`
holds it to the select.

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
  vocabulary is used; every binding points at a field, an action or a route that exists, or at a search parameter
  every route of the screen declares, which only a field that holds no secret starts with;
  `secret` is on a field alone, and a `visibility-button` on a secret input alone;
  `ranked` is on a message of two codes or more alone, each code listed once;
  a `composite` is on a secret input alone, names a composite of the platform, is opted into
  once per screen and derives no anchor the file writes or another composite derives, and no
  file writes `derivedFrom`; the platform's composites and the rows of the vocabulary's
  "Composites" name each other, each item state a row state;
  each parameter of an action taking a declared anchor (never a `visibility-button`), a
  constant or a search parameter, an item or a row of its own screen with a `dataId`, of a
  list, a table or a section, from a control (a button, a link, a tab or a field) in its part
  (in an invoke's `input`, a state only such controls enter), and a parameter two fields of a
  button's part pass with
  different values written by the button, each param of a platform source a parameter of its
  action taking a constant or a search parameter every route of the screen declares,
  never `page` or `size`; a paged source's action pages with its sizes each once, the smallest
  first, its default one of them, and takes the number parameters `page` and `size`, every route
  of its screen declares `page` and `size` as it reads them, and a screen pages one list,
  every path parses in the router's syntax, every example of a route parameter matches
  that parameter, and a `$param` without one has a value its schema accepts; every flow names states, events (never a
  `visibility-button`), guards,
  actions, anchors with their codes and bindings that exist (a clear's anchor one that carries
  codes, else a field of the flow's own screen, never a `visibility-button`, a read's anchor a
  list, section or table of the flow's own screen whose `source` is a platform action, never
  one with an entity source or none, and an invoke that says `read: false` reading in none of
  its outcomes, a navigate's
  search keys of the binding it moves to, each `{ anchor }` a field of the flow's own screen
  that holds no secret, each `{ item }` an entry with a `dataId` of a list, a table or a
  section of the flow's own screen, taken on the event of a control in its part into a key
  that takes a string, and `page: 1` beside any key a paged list of its screen reads),
  reaches each of its states
  and leaves each one that is not final, lists in a state's `meta.renders` anchors its own
  screen declares (a derived part's base, never the part), each once and never beside an
  anchor it is declared under, renders in a plain state of the root or a state of a region
  every anchor only some states render that it handles (one declared under a listed anchor
  through that anchor), guards by failure code only branches of an invoke's `onError`, each code of such a
  guard one its action fails with and listed once, and every invoke whose action fails with
  codes writes its `onError` in full or has what the request pattern needs: the one way back
  and an error when it writes none, an error when it writes its target alone; every action of `leaving`
  exists and is listed
  once, every action of `toasts` is an action of the platform, the frame's confirmation is
  declared by the frame alone, once, reserved, with both answers and no action of its own,
  and `leaving` comes with
  `unsavedInput`, whose question is a reserved dialog with a
  code and both answers that runs no action of its own; every mail a platform action declares
  goes to a parameter of the action or the account, takes its language from a parameter, the
  account or, sent to a parameter by an action no guest runs, its recipient's, and links to a
  screen whose every route declares the search parameter that
  carries its token; every notice it declares has a name no other notice of the action has,
  goes and takes its language as a mail does, never its recipient's, and links, when it does, to a screen whose
  every route needs no parameter; no binding's `guard` sends away an account its `roles` name
  (`authenticated` with `guest`, or `guest` with any other role), an anchor's `roles` are among
  those its screen's bindings serve (the frame aside), a link to a route whose roles name
  neither `guest` nor `identity` is shown only to the roles it serves (its own `roles`, else
  those of the anchor it is declared under, else its screen's), and the binding at `/$` names
  `guest` and `identity` (see "Roles"); the versions agree; the generated schemas
  equal their Zod sources; every activity agrees with the screens it visits (see
  "Activities"); every bracket reference of a scenario resolves, each code, state or value
  one the anchor named last before it in its text carries (see "Scenarios"), the activity it
  names exists, and every device acts as a role of the vocabulary; and every description the
  domain files write keeps 200 characters, one past it named with the purpose of its field (see
  "Descriptions").
- `bun run contract:check:sources`: the JSX of `apps/web/src` and `packages/ui/src` against
  the contract. It reads the four literal forms and wants each literal written once, the
  literals equal to the anchors of the screen files (an anchor no source renders is a
  problem too), no literal equal to another plus a derived suffix, every `testIdFor()`
  suffix in the vocabulary and listed in the `derived` of an anchor of the contract (of the
  base itself, when the call writes it as a literal), so a part no anchor declares, a
  `visibility-button` no input lists, is never rendered, and every code a code of the contract: a row of the vocabulary, or
  a toast code the loader derived (the rule row `<object>-<verb>ed` is no code itself). An
  anchor built at runtime is a problem. A field
  the contract says holds no input (a choice that applies at once) carries
  `holdsInput={false}` on the element with its anchor; a field that holds input carries
  nothing (`holdsInput={true}` is the default and is reported, and so is a
  `holdsInput={false}` on a field that holds input or on an anchor that is not a field), and a
  rendered field that holds no input without its opt-out is reported at its anchor. On a
  branch the pre-commit hook runs it as `contract:check:sources:ahead`, which lets the
  contract run ahead of the app (an anchor declared, not rendered yet, passes, and so does a
  field's opt-out not written yet); a commit on
  `main` and `bun run check` take the full check. The same holds for the app's machines: on a
  branch the hook runs the unit tests with `CONTRACT_AHEAD=1`, and a machine may lack what its
  flow added (a state, an event, a guarded branch, an effect) but does nothing the flow does
  not say, or is still exactly its screen's flow at the branch's merge base with `main`
  (`CONTRACT_AHEAD_BASE`; during a merge, the base the merge's commit will have, so a merge of
  `main` compares the app it brings with the flows it brings) or at the commit the branch is at
  (`CONTRACT_AHEAD_HEAD`, the contract the app was built from: a card's second business commit,
  taken onto a branch whose app already follows its first, changes a flow the base may not have
  at all), so a business commit may change a transition the app has not changed yet. The app's
  routes likewise: a binding may wait for its route, and a route that still reads as its
  binding did at the merge base (the same screen, the same path) is held to that binding as it
  was there. The hook names both commits, and the cache of the unit tests keys on them, so a
  pass never carries into another branch state with the same files. A branch whose merge base
  with a local `main` cannot be found fails the
  hook; on `main`, on a detached HEAD and in `bun run check` every machine is its whole flow. A rename or a
  removal keeps the old name declared until the implementation has switched to the new name
  or stopped rendering the removed element, then a last business commit drops it.
- `bun run contract:check:consumers`: the e2e tests under `tests/e2e/src` against the
  contract. It reads `getByTestId('...')`, the selectors `[data-testid="..."]`,
  `[data-code="..."]`, `[data-state="..."]` and `[data-value="..."]` in any string or
  template, and `expect(...).toHaveAttribute(...)` on `data-testid`, `data-code`,
  `data-state` or `data-value`, `.not` included. Every anchor must be declared, or derived
  from a declared base with a suffix it lists; every code must be a code of the contract (a
  row of the vocabulary or a derived toast code), and every state and value in the
  vocabulary, or `show` and `hide` once an input renders a `visibility-button`. A code, a
  state or a value asserted on an anchor must be one that anchor carries, as in a scenario: in
  a selector string, `[data-testid="app-shell.leave-dialog"][data-code="unsaved-input"]`, the
  attribute selectors of one element pair with its `data-testid`, and a space, a combinator,
  a comma or a `:has(` leads to another element; a `toHaveAttribute('data-code',
  'text-required')` pairs with the last `getByTestId('<anchor>')` of the receiver of its
  `expect(...)`, `page.getByTestId('organisation.notes.error')`, when every step after it
  narrows what it found (`first`, `last`, `nth`, `filter`, `and`). A receiver held in a
  variable or built by a helper pairs with nothing and is held to the contract alone. A plain
  string or a template without `${}` is a literal; an anchor built with
  `${}` or held in a name is a runtime anchor and a problem, while a code, a state or a value
  from an expression is a parameter of the test and passes. A helper such as
  `notice(page, 'profile-saved')` is not followed, and a `data-id` is data, not contract.

Beside them, `bun run e2e:coverage` pairs every scenario with its test, step for step: in
`bun run check` and in the pre-commit hook on a commit on `main`, while on a branch the hook
leaves it out, so a scenario may wait for its test. `bun run contract:coverage:check` runs
where it runs and holds the block of `COVERAGE.md` to what `contract:coverage --write` writes
(see "Coverage"). The web app's tests hold the module routes and the real router to the bindings, and
XState and the app's machines to the flows.

On `contract/trunk` the pre-commit hook first holds each commit to the business layer
(`scripts/contract-trunk.ts`): a commit that stages a file outside `contract/domain/`,
`contract/vocabulary.md` and `tests/e2e/scenarios/`, added, changed or deleted, a move counted
by both its paths, fails, naming each such file and the branch it belongs on. The vocabulary
counts whole, so an edit of its grammar there is the review's to see in the trunk's diff; a
merge passes, as it brings `main` in with every layer.

On any other branch but `main` and `feat/contract-first-pass` (an experiment's aside), the
commit-msg hook holds a commit that changes the business layer to a take's form
(`scripts/contract-take.ts`): its subject `<type>(contract): <the card's goal>`, the business
layer alone, and as its last paragraph `Taken-from: contract/trunk <first>^..<last> <card>`,
each commit or run of them oldest first, on the trunk's own line, changing every file it stages;
a business commit the rules let the branch write itself (the last one of a rename or a removal,
a feature begun there before the trunk, an amendment allowed there) names its cards in
`Written-on-branch: <card>` instead. Nothing else there names the `contract` scope, so
`git log main..<branch> -E --grep='^[a-z]*\(contract\):'` lists the branch's contract changes
(`main..` leaves out the meta rounds `main` brings in) and `--grep='^Taken-from:'` its takes. A
plain cherry-pick or rebase runs no hook and a revert of a take fails it. The check reads the
`git commit` that runs the hook from `/proc`, its options parsed as git parses them: an amend is
judged as the whole commit it leaves, and the message as git records it, cut at its scissors line
under `--verbose` and its comment lines stripped or kept by the cleanup mode; where git's default
mode leaves that to whether an editor opened, a message its comment lines change fails, and so
does one the comment characters git may pick under `core.commentChar=auto` read differently.
Without
`/proc` (another system), an amend is judged by what it adds and the message is cut at a
scissors line it holds. A take is checked against
`main` and `contract/trunk` as the clone knows them, the remote's when it has no branch of its
own. The pre-commit hook first refuses a commit
while a hook `lefthook.yml` names is not installed (`scripts/hooks-installed.ts`): lefthook
installs the hooks on `bunx lefthook install` (or `bun install`), and by itself on a hook run
that notices `lefthook.yml` changed (an edit in the same second as the last install can pass
unnoticed), unless told not to (`--no-auto-install`), but a hook whose file went while
`lefthook.yml` stayed the same stays missing.

On `main` the same hook judges every commit as a landing (`scripts/contract-take.ts`), the squash
of one branch, against its parent: `main`'s HEAD, or, for an amend, the commit under the one it
replaces. A merge into `main` is refused, as `main` takes only squashes; any other commit
carries exactly one `Squashed-from: <branch> (<tip>) [<cards>]` trailer as its last paragraph,
the cards optional for the hook (the landing procedure still names the card). The branch must
exist by its exact ref, `refs/heads/<branch>`, so a revision such as `feat/me~0` names none; the
tip, 7 to 40 hex digits, must be that branch's tip or one of its ancestors, and a short id git
cannot tell from another commit is refused. The parent must lie under the tip, and the committed
tree must equal the tip's tree and differ from the parent's, so a landing is
`git merge --squash <branch>` and nothing more or less. Then the branch's round is judged: the
commits of the tip that are neither on the parent nor under the tip of an earlier landing's
trailer, merges left out, each against the take rules above as git recorded it, its message and
the files it changes. A recorded commit of the round that breaks the take rules stops the squash
even when its own hook was skipped (a plain cherry-pick, a `--no-verify` commit). The refusal
names each commit that fails and how to rewrite it; the check grants no waiver. `contract/trunk`
and an experiment never land, an experiment being split into area branches first. The engine's
branch, `feat/contract-first-pass`, is bound by the trailer like any other branch, but its round
is not judged, as its meta commits carry the `contract` scope with the engine's own files.
`bun run scripts/contract-take.ts --round [<branch>]` prints that verdict for a branch (the
checked-out one by default) without writing anything, so it runs before the gates; it ends with
`contract take: every commit of <branch> since its last landing (<n>) is in its form` when every
commit of the round is. The check has limits. It sees a commit only where git runs the
commit-msg hook for it: a change of `main` that runs none is not seen, a fast-forward, a plain
cherry-pick or revert, a rebase, or a commit made with `--no-verify`, the squash's own included.
`main` changes only by a squash commit, by procedure, and the check cannot force it. A merge's own
resolution is not judged, as a merge of the round is left out. Without `/proc` (another system)
an amend is not detected, so the commit is judged against HEAD, and an amend that adds no change
to `main` is refused as not changing it. An earlier landing's tip that the clone lacks cannot
bound the round: its commits are judged again, and a refusal names those tips, so that the
branch which landed them can be fetched. An amend of a landing is made before its merge back
into the branch: after it, the replaced landing falls into the round and is judged there.

## The manifest

`bun run contract:manifest` builds `ui-manifest/manifest.json` from the contract files and
the scenarios, only after the contract check passes, and validates it against
`manifest.schema.json` before it writes anything. The web build writes it into
`apps/web/dist/ui-manifest/` (the dev watcher into `apps/web/dist-dev/ui-manifest/`), and both
stands serve it at `/ui-manifest/manifest.json`, with
`manifest.schema.json` and `model.schema.json` beside it and `Cache-Control: no-store`.
`PERCH_UI_MANIFEST=0` on a stand answers 404 there.

It is what a tool outside the repository reads: the vocabulary as tables with prose
instructions for an agent (`derivedParts` gives each derived suffix the kind of its part, the
meaning of the suffix as its `description` and, for a `visibility-button`, its values;
`composites` is the vocabulary's table of the platform's composites, whose declarations are
under `platform.composites`), the screens (each binding with its `example` link, each anchor
with its description, written or derived), the platform section and the activities verbatim,
the scenarios parsed, the route parameters, the model, and `ids`, every declared anchor with
its kind, its screen and its attributes (a ranked message's `ranked`, a secret input's
`composite`, and `derivedFrom` on
the anchors a composite derives: `{ composite }` on its list, `{ composite, item }` on an
item), one entry per line, so a search for an anchor in the manifest shows its facts.

On a development build, and on a production build made with `PERCH_UI_HOOKS=1` (the e2e
stand's), `window.__perch.ui.anchors()` lists the anchors the page renders now, each with
its kind, `data-state`, `data-code`, `data-id`, `data-value` and visibility, with the page's
URL. Without the helper, the names a page renders are still there:

```js
;[...document.querySelectorAll('[data-testid]')].map((element) => element.dataset.testid)
```

An e2e run exposes the binding `window.__perchSettledState` (`SETTLED_STATE`), and such a
build reports to it each settled state of a screen's machine, once the page has rendered it:
the screen, the state value and the page as the helper reads it then (`SettledState`). The
harness holds every report to the manifest the stand serves (`settledProblems`), and a test
fails at its end when a state it passed through broke it. Of the anchors a screen renders only
where listed, with their derived parts, one the state does not render is not visible, and one
it renders is on the page and visible, unless data decides whether it shows: an anchor with
`roles` or `own`, an entry of a list (`dataId`), or an anchor nested under one of these, which
only the first holds, as are the parts a page shows on demand (a select's `option`, a
composite's `item`, a field's `error-message`, a paged list's `range`, `previous-link` and
`next-link`, which its read decides; its `size-select` shows wherever the list does). The anchors every state renders are not held:
a message shows when it carries a code, and an error when there is one.

## Coverage

`bun run contract:coverage` prints how far the contract reaches, and `--write` puts the same
block into `COVERAGE.md`. It is a report, not a gate: no measure fails a commit. The block stays
current, though: `bun run contract:coverage:check` (`ui-contract coverage --check`) fails when
the block in `COVERAGE.md` is not what `--write` would write, naming that command, and says so
in one line when it is. It runs in `bun run check` and in the pre-commit hook on a commit on
`main`; on a branch, the contract trunk included, the hook leaves it out, so a block left behind
fails `bun run check` before a landing, and the squash on `main`.

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

After the totals, a note names each composite the platform declares and no screen opts into,
which fails nothing.

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
renamed, the composites added or removed, the derived parts, the codes, the states, the roles
and the error fields the anchors both sides hold gain or lose, the messages among them that
rank their codes, with their order, who each route serves, the platform action each list reads
with its params and its paging, the platform actions added or removed
and the notices they declare, the transitions added or removed in each activity both sides
hold, the lines of the flow added or removed in each screen both sides hold with a flow, the
lines of each platform action added, removed or changed, and each written description added,
removed or changed with its length before and after), and below
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
screen and kind. The derived parts of an anchor are listed by name,
`<anchor>.<suffix>` (`<input>.visibility-button` for the eye of a password input). The codes and the
error fields of an anchor are those the loader gives it,
written or derived, as `<anchor> <code>` and `<error> <code> -> <field>`, and its states as
`<anchor> <state>`, so a change of a composite's item state shows on each item it derives. A
route's `guard` and each role it serves are listed as `<path> guard <guard>` and `<path>
serves <role>`, a route added whole with every line, and each role an anchor both sides hold
is shown to as `<anchor> <role>`. A list that reads a platform action is listed as `<anchor>
reads platform.<action>`, then each param by name (`q=search:q`, `kind="all"`), then `paged`
when it pages: a list moved to another search or to paging shows as its old line removed and
its new one added, and a list added whole shows its line. A
ranked message is listed with its order, `<anchor> ranks <code> > <code>`: a new order shows
as its old line removed and its new one added, which its codes, compared as a set, do not
show. A
notice is listed by its action and its name, `<action>.<name>`. A composite is listed by its
name. A screen's flow is listed as `flow lines added in <screen id>` and `flow lines
removed in <screen id>`, one line per fact the flow says: its initial state and each
region's, each guard by failure code with the codes it takes (`guard emailNotVerified takes
email-not-verified`; a guard's sentence is prose and has no line), each state's address,
each anchor a state renders (`check-mail renders user.sign-in.resend-button`, a state of a
region by its path, `viewing.create-form.open`), each `entry` and `exit` effect, each
transition on an event with its target, guard and effects, each invoke with its input as
JSON, its `read: false` when it says one, and its outcomes, each final state. Where order runs the machine (the guarded
alternatives of an event or an outcome, the effects of an `entry` or an `exit`), an item of a
sequence of more than one carries its position, `#<n>`. Descriptions are left out of a flow's
lines, as they change nothing that runs, so a screen file written shorter that loads to the same
flow shows no flow line. A platform action is listed by its name, and its lines as `platform action lines
added in <action>` and `platform action lines removed in <action>`, one per fact it declares:
each parameter with its type (`param email: string`), its result (`result: <the text>`, the
one prose that stays, since it says what holds once the action succeeds), each code its failure
shows (`code rate-limited`), each role that may run it, its page sizes when it pages (`paged by
10, 25, 50, 25 by default`), its mail (`mail to email language
locale link user.verify-email?token`: who it goes to, the language it speaks, the screen its link
opens and the search parameter that carries the token) and each notice (`notice
password-changed to account language account link user.forgot-password`). An action added or
removed whole shows every line, as nothing else in the summary says its mail. Last, `descriptions
changed:` lists, sorted by place, each description a domain file writes (see "Descriptions")
that the change adds, removes or changes, with its length in characters before and after:
`app-shell.theme-select 191 -> 340` (a shrink alike, `340 -> 191`), `new -> 120` for one added,
`340 -> gone` for one removed, and the same length on both sides for a text changed at its
length. Its place names it alike at any ref (`app-shell.theme-select`, `user.profile` for the
screen's own, `user.profile state loading` for a container state, `app-shell flow ready on
platform.theme-set` for a transition, `platform event started`, `model field profile.name`), a
renamed anchor's under its new name, so a description that grows clause by clause shows on
review even where nothing that runs changed. The tests are in this repository, so the same
change updates them, and the consumers check fails until it does.

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
