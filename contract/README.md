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
  REFERENCE.md       every key and rule of the contract, generated, never edited by hand
  COVERAGE.md        the coverage note
  vocabulary.md      the closed lists
  domain/            what a feature describes: the model, the platform, the screens, the activities, the terms
  schemas/           the JSON Schemas generated from the tooling, never edited by hand
```

The authored files, edited by hand or by a model in the modeling thread:

- `vocabulary.md`, Markdown: the closed lists, one table per section (the kinds of anchors,
  the derived suffixes, the attributes, the app, container and row states, the codes, the
  choice values, the screen names, the anchors
  the shell reserves and the platform's composites). Its
  `Grammar` section says how an anchor is spelled. The loader reads each table by its fixed
  heading. The grammar, the kinds, the suffixes and the attributes are the engine's (meta);
  every other table is content a feature adds with the screen file that first uses it
  (business). The contract version is not in it: since version 2 it is said only in
  `domain/platform.yaml`.
- `domain/terms.yaml`, YAML: the project's language. Its `contexts` are the bounded contexts
  (one while the product is one), its `terms` the platform's nouns (account, organisation,
  membership, invitation, device, session) and its `roles` the roles a device holds: each with
  its `meaning` within the budget of a description, its `synonyms`, the words the texts never
  use for it, and its `storage`, the name storage gives it where that differs (organisation is
  the table `tenant`; no applied migration is renamed). Every contract writes it and keeps its
  roles there; the vocabulary lists none. The check refuses a synonym in a description, a
  behaviour text, an action's, an invariant's, a screen's, an anchor's, a value's or a field's
  name, an enum's value, a route path, a role's name, a row of the vocabulary's tables, an
  activity's names or a scenario's prose; code and
  tests name a role or a route through `CONTRACT_ROLES` and `CONTRACT_ROUTES`
  (`ui-contract emit terms`), never by hand, which the ESLint rule `workspace/contract-terms`
  holds ([the rule](REFERENCE.md#rule-terms)).
- `domain/screens/<pathname>.yaml`: one screen per file, named by the path of the screen's
  first binding without the leading `/`. `/sign-in` is `domain/screens/sign-in.yaml` and `/me`
  is `domain/screens/me.yaml`; a nested path is a folder (`/org/$org` would be
  `domain/screens/org/$org.yaml`) and `/` would be `domain/screens/index.yaml`. The frame, the
  one screen without a binding, is `domain/screens/__root.yaml`, as in file-based routers. The screen's `id` (`user.profile`) is the
  prefix of its anchors, not its file name. The loader reads the folder sorted by path; a
  file that is not `.yaml`, or one named otherwise than its first binding says, is a problem
  of that file.
- `domain/platform.yaml`: the contract version, said there once, the version of the format the
  files are written in and the engine reads them by, at most the tooling's `CONTRACT_VERSION`
  (only a contract at version 1 repeats it, in the vocabulary's `Contract version` line), and
  the platform section: the actions every
  screen may run (signing up, in and out, organisations, devices), the events it raises
  in a flow (the local data opened, or could not be), `leaving`, the actions whose run
  leaves what the user typed behind, `unsavedInput`, how every leave that would lose it asks
  first, `toasts`, the platform actions whose success toasts with their codes, `composites`,
  the lists with their items a screen derives by opting in (see "What a screen leaves out"),
  the reserved anchors and the readiness line.

  An action says what it answers ([the rule](REFERENCE.md#rule-action-outcomes)): its
  `result` is one outcome or a list of outcome lines, the plain success first, then each other
  outcome under its own condition; its `codes` map each code a failure shows to the condition
  it answers on, or to the invariants it refuses for, `{ invariant: <name> }` or
  `{ invariant: [<name>, <name>] }`, with `condition: <text>` beside them for a cause that is no
  invariant. An invariant, under `invariants`, is a rule
  several actions keep, said once with the code it `refuses` with; each action that keeps it
  names it under that code, and the engine derives the actions it limits, which the manifest
  carries. Each outcome line, condition and rule keeps the budget of a description. From version
  6 the check refuses the older forms, a list of the codes' names and a `result` of one string
  past the budget; a contract at an older version still loads them:

  ```yaml
  invariants:
    device-limit:
      rule: An account is signed in on ten devices at most at once, each counted once while its session lasts.
      refuses: device-limit
    failed-sign-ins:
      rule: Ten wrong passwords of one email within a quarter of an hour keep its password out.
      refuses: rate-limited
    address-mails:
      rule: A network address is charged 200 mail requests a quarter of an hour at most.
      refuses: rate-limited
  actions:
    sign-in:
      # description, params, changes
      result:
        - the device is signed in, and the app moves to /me with code welcome
        - "with the second factor on: the answer asks for a code and signs no device in"
      codes:
        invalid-credentials: the email or the password is wrong
        device-limit: { invariant: device-limit }
        rate-limited: { invariant: failed-sign-ins }
        failed: anything else fails
    change-email:
      # description, params, result, changes
      codes:
        rate-limited:
          invariant: [ failed-sign-ins, address-mails ]
          condition: a fourth change by the account within a quarter of an hour
  ```

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
    # description, params, result, codes, changes
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

  Every action says under `changes` the reads it changes: the platform actions whose answer,
  for the organisation, the account and the params it ran with, differs once it succeeds, each
  one that a list, a section or a table of some screen takes as its `source`.
  `organisations.invite` changes `organisations.invitations`, and `sign-out-everywhere` changes
  `devices.list` and `accounts.read`. A switch of the organisation or the account (a select, a
  create, an accept) is the first read's (see "Reading a screen file", `source`), so it is never
  named, and neither is what another account reads for itself: an invitation does not change
  the inviter's `invitations.mine`. `changes: []` says the action changes none; the schema
  refuses an action that does not write `changes`, as it refuses one without `codes`. The check
  refuses a name that is not a platform action, an action that names itself, as it changes what
  other reads answer, a name that no list, section or table takes as its source, and a name
  written twice in one `changes`. A flow that runs the action reads, after its success, each
  list of its screen whose source the action changes (see the effects of a flow, `read`).
- `domain/model.schema.json`: the data model, a JSON Schema 2020-12 document with one `$defs` entry
  per entity and the contract's `x-perch` keyword (table, region, id prefix, owner, rules,
  actions, how each field merges). Every action of `x-perch.actions` says the reads of the
  platform it changes under `changes`, as a platform action does, `[]` for none, held by the
  same schema and check: `profile.updateName` changes `accounts.list` and `accounts.read`,
  where the name shows.
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
structure). A platform action's `result`, the conditions of its codes and the rules of the
invariants are no descriptions: they are behaviour, which the hand-over diff lists with their
text, and they keep the same budget.

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

The [reference](REFERENCE.md) writes each key of a screen file, and each rule the engine
holds it to, once, generated from the schemas' describe texts and the engine's rules. This
section says where to look and keeps what a writer must do; the reference holds the rest.

A screen's `title` and `description` ([`title`](REFERENCE.md#screen-title),
[`description`](REFERENCE.md#screen-description)): the description says what the screen is
for, never a list of its parts.

A screen's `bindings` are its routes in TanStack Router's format, and a route is a state
address: the same path with the same search reaches the same state after a reload
([the rule](REFERENCE.md#rule-route-bindings), [`path`](REFERENCE.md#screen-bindings-path),
[`history`](REFERENCE.md#screen-bindings-history),
[`retain`](REFERENCE.md#screen-bindings-retain)). The frame
([`frame`](REFERENCE.md#screen-frame)) has no route. The application's router builds and
matches every binding (`apps/web/src/platform/routes-router.spec.ts`), and the module routes
equal the bindings (`routes-contract.spec.ts` beside it).

**Roles.** A binding's `roles` are the roles it serves: the router decides by its `guard`,
then its `roles`, then reads the search, and an account that holds none of the roles gets the
not-found screen at the same address ([the rule](REFERENCE.md#rule-roles),
[`roles`](REFERENCE.md#screen-bindings-roles), [`guard`](REFERENCE.md#screen-bindings-guard),
an anchor's [`roles`](REFERENCE.md#screen-anchors-name-roles)). A route that must not show
itself to a guest leaves its `guard` out and names no `guest`. `GUEST`, `IDENTITY`,
`heldRoles` and `admits` of `@workspace/ui-contract/anchors` read the roles for the app and
the checks alike. The roles are the terms file's ([the rule](REFERENCE.md#rule-terms)), and code
names one through `CONTRACT_ROLES`, a route through `CONTRACT_ROUTES`, never by hand.

A parameter of `params` or `search` may carry `examples`, which `contract:check` holds to the
parameter's schema; `bun run contract:routes` (`ui-contract routes [--json]`) prints the
routes with one example link per binding and the route tree
([the rule](REFERENCE.md#rule-route-example),
[`examples`](REFERENCE.md#screen-bindings-params-properties-name-examples)).
`apps/web/src/platform/routes-examples.spec.ts` holds every example to the real router.

A screen's `entry` lists the anchors a test starts from; some are alternatives by state, so a
test waits for the one its state shows, never for all of them
([the rule](REFERENCE.md#rule-screen-entry), [`entry`](REFERENCE.md#screen-entry)).

An anchor's `binding` says what the element does or shows: a field of the model, an action
with its params, a route or a search parameter
([`binding`](REFERENCE.md#screen-anchors-name-binding)). Its other keys are
[`codes`](REFERENCE.md#screen-anchors-name-codes),
[`ranked`](REFERENCE.md#screen-anchors-name-ranked),
[`fields`](REFERENCE.md#screen-anchors-name-fields),
[`dataId`](REFERENCE.md#screen-anchors-name-dataid),
[`dataValue`](REFERENCE.md#screen-anchors-name-datavalue),
[`states`](REFERENCE.md#screen-anchors-name-states),
[`derived`](REFERENCE.md#screen-anchors-name-derived),
[`roles`](REFERENCE.md#screen-anchors-name-roles), [`own`](REFERENCE.md#screen-anchors-name-own),
[`holdsInput`](REFERENCE.md#screen-anchors-name-holdsinput),
[`secret`](REFERENCE.md#screen-anchors-name-secret),
[`composite`](REFERENCE.md#screen-anchors-name-composite) and
[`source`](REFERENCE.md#screen-anchors-name-source). An anchor's
[`description`](REFERENCE.md#screen-anchors-name-description) says what it is for; where the
engine can say it, the file leaves it out ([the rule](REFERENCE.md#rule-engine-descriptions)).

A list's `source` says where its entries come from, and with it when they are read: every
other read is the flow's effect `read: <anchor>`, never prose in a description
([the rule](REFERENCE.md#rule-list-reads)). A platform source's `params` are search
parameters of the route or constants, never a field. `paged: true` makes the list a page of
the action's entries and derives its range, its links and its size select, which a screen
file never writes ([the rule](REFERENCE.md#rule-paged-list),
[`paged`](REFERENCE.md#screen-anchors-name-source-paged)).

A screen's [`states`](REFERENCE.md#screen-states) say what is visible in each container
state, and its [`wireframe`](REFERENCE.md#screen-wireframe) is the default state
([the rule](REFERENCE.md#rule-screen-entry)).

A screen's `flow` is an XState v5 machine config in the subset `createMachine` takes as
written ([states](REFERENCE.md#rule-flow-states), [`id`](REFERENCE.md#screen-flow-id)):
`contract:check` runs it, and an app that builds its own machine for the screen holds it to the
flow with the engine's comparison (`@workspace/ui-contract/machines`), as it holds its router
to the bindings. What the flow writes, one rule each:

- **Events and guards** ([the rule](REFERENCE.md#rule-flow-events),
  [`meta.guards`](REFERENCE.md#screen-flow-meta-guards)): an event is an anchor acted on, a
  platform event or a data event; a control whose anchor is an event is enabled exactly while
  a state the machine is in handles it, and the app reads that from its machine and keeps no
  flag of its own.
- **Effects** ([the rule](REFERENCE.md#rule-flow-effects)): `show`, `clear`, `read` and
  `navigate`, which the app implements, each with what it may name.
- **The read after an action** ([the rule](REFERENCE.md#rule-read-after-an-action)): it is
  mandatory where the action may change what a list shows, and an invoke or one branch of its
  outcome says `read: false` where nothing reads.
- **Invoke** ([the rule](REFERENCE.md#rule-flow-invoke),
  [`meta.address`](REFERENCE.md#screen-flow-states-name-meta-address)): an action run while
  the machine is in its state. The route owns the addressable state, the machine the
  transient one. No state declares an address yet.
- **What a state renders** ([the rule](REFERENCE.md#rule-renders),
  [`meta.renders`](REFERENCE.md#screen-flow-states-name-meta-renders)): an anchor only some
  states render is listed in their `meta.renders`; rendered means visible to the user, the
  app reads it from its machine (`renderedAt`, `isRendered`), and an e2e run holds the page to
  it in every settled state.
- **The shorter forms** ([the rule](REFERENCE.md#rule-flow-shorter-forms),
  [`pattern`](REFERENCE.md#screen-flow-states-name-states-name-pattern),
  [`by`](REFERENCE.md#screen-flow-states-name-states-name-by)): a transition as its target,
  an effect by its name, a region by its pattern or by its button, which the loader expands
  before anything reads the flow; `bun run contract:flow <screen>` prints the full config.
- **What the subset leaves out, and the walk** ([the rule](REFERENCE.md#rule-flow-run)):
  nothing else of XState is in the subset, and `contract:check` takes every state and every
  transition in XState.

### What a screen leaves out

What a screen would only repeat of the model, the platform and its own bindings, it leaves
out, and the loader derives it the same way every time
([the rule](REFERENCE.md#rule-what-stays)). The items below are what it derives from the model,
the platform and the flow, and a value the file writes wins:

- **What an action fails with** ([the rule](REFERENCE.md#rule-failure-codes)): the platform's
  codes for a platform action; for a model action `forbidden`, the codes of the fields it sets,
  then `failed`.
- **A button's params** ([the rule](REFERENCE.md#rule-button-params)): the params the fields
  of its part pass to the action it binds.
- **An error's codes and fields** ([the rule](REFERENCE.md#rule-error-codes-and-fields),
  [`codes`](REFERENCE.md#screen-anchors-name-codes),
  [`fields`](REFERENCE.md#screen-anchors-name-fields)): from the actions its part binds, the
  actions its flow invokes against it and the codes the flow shows on it.
- **Whether a field holds input** ([the rule](REFERENCE.md#rule-field-holds-input),
  [`holdsInput`](REFERENCE.md#screen-anchors-name-holdsinput)): a field holds input unless its
  own change applies it at once and nothing else applies it; the app is to ask before a leave
  that would lose what is typed.
- **Which states a field carries** ([the rule](REFERENCE.md#rule-field-states-carried),
  [`states`](REFERENCE.md#screen-anchors-name-states)): `unsaved` and `saved`, from the
  vocabulary's "Field states".
- **Which leaves ask first** ([the rule](REFERENCE.md#rule-leave-questions),
  [`unsavedInput`](REFERENCE.md#platform-unsavedinput),
  [`leaving`](REFERENCE.md#platform-leaving)): `platform.yaml` declares every leave that would
  lose what was typed and how the app asks; a navigate sits on a transition, once.
- **What a failure shows** ([the rule](REFERENCE.md#rule-failure-show)): which codes a `show`
  in an `onError` takes; a bare `show` after branches that take every code is refused.
- **The outcome of a request** ([the rule](REFERENCE.md#rule-request-outcome)): an invoke whose
  action fails with codes and writes no `onError` clears its error on entry and goes back the
  one way it came; a state with no single way back writes its `onError`.
- **The region of a button** ([the rule](REFERENCE.md#rule-button-region)): a button bound to
  one action that no state handles gets a region of its own.
- **The toast of a success** ([the rule](REFERENCE.md#rule-success-toast),
  [`toasts`](REFERENCE.md#platform-toasts)): every mutation says its success on the frame's
  toast once, where the operation ends; a failure never toasts; `toast: false` is the one ban.
- **The question before a destructive action** ([the rule](REFERENCE.md#rule-destructive-question),
  [`confirm`](REFERENCE.md#screen-anchors-name-confirm)): every control that runs a
  destructive action asks first through the frame's confirmation; `confirm: false` on a control
  that runs one is the one way out.
- **A composite of the platform** ([the rule](REFERENCE.md#rule-composite-of-the-platform),
  [`composite`](REFERENCE.md#screen-anchors-name-composite)): a list with its items that
  several screens show is declared once in `platform.yaml`, and a secret input opts in with
  `composite: <name>`.
- **A description the engine can say** ([the rule](REFERENCE.md#rule-engine-descriptions));
  `bun run contract:coverage --descriptions` lists the written descriptions the engine would
  say itself, for the developer to drop.

What stays in a screen is what a tester or a user can tell apart: the areas and their states,
where each control leads, a success or a failure that goes elsewhere than the derived one,
guards, confirmations and chains of actions ([the rule](REFERENCE.md#rule-what-stays)).
`bun run contract:diff <ref>` lists what the anchors gain or lose, derived values included
([the rule](REFERENCE.md#rule-contract-diff)).

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

An anchor is the value of `data-testid`: 2 to 4 dot-separated kebab-case segments, the screen
name first and the kind last (`user.sign-in.email-input`). It names what the element is for,
never its text, its colour, its position or an entity's id
([the grammar](REFERENCE.md#rule-anchor-grammar)). A derived anchor adds one suffix from the
vocabulary's closed table, and code builds it only with `testIdFor(base, suffix)` from
`@workspace/ui-contract/anchors`.

`visibility-button`, the eye a password input renders beside itself, is the one derived part
that is presentation only: a secret `input` alone has it, derived from version 4
([the rule](REFERENCE.md#rule-kind-parts); a file of version 3 or below may list it in `derived`),
and it is never an event of a flow ([the rule](REFERENCE.md#rule-visibility-button),
[`secret`](REFERENCE.md#screen-anchors-name-secret)). A paged list's `range`, `previous-link`,
`next-link` and `size-select` are derived by the loader and never written
([the rule](REFERENCE.md#rule-paged-list)).

One literal per rendered name, so a search finds every place a name lives: every anchor is
declared once, in one screen file, and written once in the sources; no anchor equals another
one plus a derived suffix; an `item`, `row` or `option` is the one anchor that marks many
elements. In code an anchor is a literal in one of four forms, never built at runtime
([the grammar and the four forms](REFERENCE.md#rule-anchor-grammar)).

## Attributes

An anchor says its state in attributes, never in its wording: `data-id`, `data-value`,
`data-from`, `data-to`, `data-total`, `data-state` and `data-code`
([the rule](REFERENCE.md#rule-attributes), [`dataId`](REFERENCE.md#screen-anchors-name-dataid),
[`dataValue`](REFERENCE.md#screen-anchors-name-datavalue),
[`codes`](REFERENCE.md#screen-anchors-name-codes)). The page speaks the user's language, so
tests and agents never assert its words: they assert the anchor with its code, state, id or
value. A behaviour that varies is a code or a state of one anchor, never a second anchor, and a
domain code is mapped to a contract code in the presentation layer.

## Marking a page

The anchor goes on the semantic element whose role its kind maps to, never on a wrapper, and a
control that is not a test target carries a coverage-ignore marker, never a made-up anchor
([the rule](REFERENCE.md#rule-marking-a-page)). Repeated items share one static anchor with
`data-id`; a composite takes one `testId`, and a feature never declares or renders a reserved
anchor ([the rule](REFERENCE.md#rule-entries-of-a-list)).

## Locating an element

By its anchor first (`getByTestId`), then by role inside the container found by its anchor,
then by label or placeholder; never by a CSS class or the shape of the DOM. When a test has to
fall back to the label or the placeholder, the element needs an anchor: ask for one (see
"Asking for a missing anchor"; [the rule](REFERENCE.md#rule-marking-a-page)).

## Readiness and container states

Wait for `app-shell.status` to reach the state `ready`, then for the screen's container to
leave `loading` ([the rule](REFERENCE.md#rule-readiness)).

## Notices

`app-shell.notice-message` shows one notice at a time, the latest; find it by its anchor and
its code together, right after the action that raises it. A message whose codes more than one
source may raise says `ranked: true` with its `codes` in rank order
([the rule](REFERENCE.md#rule-notices), [`ranked`](REFERENCE.md#screen-anchors-name-ranked)).

## Scenarios

A scenario is an instruction a person could follow by hand, one Markdown file each, in the
e2e tree beside its test (`tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md` and
`tests/e2e/src/<same path>.e2e.spec.ts`). Its id is the file's path under
`tests/e2e/scenarios/` without `.md`, never written inside the file
([the files](REFERENCE.md#rule-scenario-files)). The file is a front matter and fixed
sections ([the format](REFERENCE.md#rule-scenario-format)), and its brackets reference the
contract, each one resolved by the check, a code, a state or a value to the anchor the text
names last before it ([the brackets](REFERENCE.md#rule-scenario-brackets)).

The test pairs with the scenario by its path and names it on its first line,
`// scenario: <id>`, with one `test.step` per step; `bun run e2e:scaffold <id>` writes a
failing test from a new scenario, and `bun run e2e:coverage` checks the pairs
([the rule](REFERENCE.md#rule-scenario-tests)).

The scenarios are the contract's feedback loop. A scenario is written from the contract
alone: when it needs an anchor, a code, a state, a route or a role the contract lacks, that
gap is fixed in the contract files first, never worked around in a test
([the rule](REFERENCE.md#rule-contract-gaps)).

## The checks

`bun run check` and the pre-commit hook run three contract checks. Each prints
`file:line: message` per problem and exits 1, or a one-line summary
([the rule](REFERENCE.md#rule-checks)):

- `bun run contract:check`: the files on their own and against each other: their shapes, the
  vocabulary, the terms and their synonyms ([the rule](REFERENCE.md#rule-terms)), the bindings, the flows, the platform, who each route serves, the scenarios, the
  schema drift, the reference's drift and each link of a guide into the reference
  ([the files](REFERENCE.md#rule-check-files), [the bindings](REFERENCE.md#rule-check-bindings),
  [the flows](REFERENCE.md#rule-check-flows), [the platform](REFERENCE.md#rule-check-platform),
  [the access](REFERENCE.md#rule-check-access)). A commit on `main`, and `bun run check`, which
  checks the tip of a branch before it lands, also check that the contract is at the version the
  engine reads (`contract:check --current`).
- `bun run contract:check:sources`: the JSX of `apps/web/src` and `packages/ui/src` against the
  contract ([the rule](REFERENCE.md#rule-check-sources)).
- `bun run contract:check:consumers`: the e2e tests under `tests/e2e/src` against the contract
  ([the rule](REFERENCE.md#rule-check-consumers)).

`bun run contract:migrate` moves a contract at an older version to the tooling's, step by step
(`--write` rewrites the files; `packages/ui-contract/MIGRATIONS.md` says what each version
changed); `contract:check` passes an older contract and names it in one line
([the rule](REFERENCE.md#rule-editions-and-migrations)).

Beside them, `bun run e2e:coverage` pairs every scenario with its test, and
`bun run contract:coverage:check` holds the block of `COVERAGE.md` to what
`contract:coverage --write` writes (see "Coverage"). On a branch the hook lets the contract
run ahead of the app, and a commit on `main` takes the full check
([ahead mode](REFERENCE.md#rule-ahead-mode)). The hooks hold the contract trunk to the business
layer, a take on a branch to its form and a landing on `main` to the squash of one branch
([the trunk](REFERENCE.md#rule-trunk-commits), [a take](REFERENCE.md#rule-take-form),
[a landing](REFERENCE.md#rule-landing-form)).

## The manifest

`bun run contract:manifest` builds `ui-manifest/manifest.json` from the contract files and the
scenarios, only after the contract check passes; every stand serves it at
`/ui-manifest/manifest.json`, and `PERCH_UI_MANIFEST=0` on a stand answers 404 there
([the rule](REFERENCE.md#rule-manifest)).

On a development build, and on a production build made with `PERCH_UI_HOOKS=1` (the e2e
stand's), `window.__perch.ui.anchors()` lists the anchors the page renders now
([the helper](REFERENCE.md#rule-page-helper)). An e2e run holds every settled state of a
screen's machine to the manifest, and a test fails at its end when a state it passed through
broke it ([the rule](REFERENCE.md#rule-settled-state)).

## Coverage

`bun run contract:coverage` prints how far the contract reaches, and `--write` puts the same
block into `COVERAGE.md`; `--unmarked` lists the controls that carry no anchor.
`bun run contract:coverage:check` fails when the block is not what `--write` would write. A
control that is not a test target is declared off the coverage by a marker right before its
element with its reason, `// ui-contract-ignore: <reason>` or
`{/* ui-contract-ignore: <reason> */}`; a marker that ignores no control fails the command
([the rule](REFERENCE.md#rule-coverage), [the markers](REFERENCE.md#rule-check-sources)).

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
lines of each platform action added, removed or changed, the reads each action of the model
comes to change or stops changing, and each written description added,
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
JSON, its `read: false` when it says one, and its outcomes, a branch's `read: false` after its
guard (`viewing.member-roles.changing onDone #1 -> idle [ownDemotion] read: false`), each final state. Where order runs the machine (the guarded
alternatives of an event or an outcome, the effects of an `entry` or an `exit`), an item of a
sequence of more than one carries its position, `#<n>`. Descriptions are left out of a flow's
lines, as they change nothing that runs, so a screen file written shorter that loads to the same
flow shows no flow line. A platform action is listed by its name, and its lines as `platform action lines
added in <action>` and `platform action lines removed in <action>`, one per fact it declares:
each parameter with its type (`param email: string`), each line of its result (`result: <the
line>`, `result #<n>: <the line>` by position when there are several, the first being the plain
success; the prose that stays, since it says what the action answers), each code its failure
shows with its invariants and its condition, quoted (`code invalid-code: "<the condition>"`, `code
device-limit: invariant device-limit`, `code rate-limited: invariant failed-sign-ins,
address-mails; "<the condition>"`), each role that may run it, its page sizes when it pages (`paged by
10, 25, 50, 25 by default`), each read it changes (`changes organisations.invitations`), its mail (`mail to email language
locale link user.verify-email?token`: who it goes to, the language it speaks, the screen its link
opens and the search parameter that carries the token) and each notice (`notice
password-changed to account language account link user.forgot-password`). An action added or
removed whole shows every line, as nothing else in the summary says its mail. An invariant is
listed by its name, as `invariant lines added in <name>` and `invariant lines removed in
<name>`, its rule (`rule: <the text>`) and its code (`refuses <code>`). The reads an
action of the model changes are listed by the entity and the action, as `model action lines
added in <entity>.<action>` and `model action lines removed in <entity>.<action>`, a line each
in the same form (`model action lines added in profile.updateName: changes accounts.list,
changes accounts.read`); an action added or removed whole shows each read it changes. Last, `descriptions
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

The reference writes what the diff lists once, line by line:
[the diff](REFERENCE.md#rule-contract-diff), [its lines](REFERENCE.md#rule-contract-diff-lines),
[the written descriptions](REFERENCE.md#rule-description-places) and
[the hand-over](REFERENCE.md#rule-hand-over).

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
