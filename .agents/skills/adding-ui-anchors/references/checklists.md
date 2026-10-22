# Checklists

Each list runs in the order of work: the model, the screen file, the scenario, then the code
and the tests. The rule: `.cursor/rules/ui-contract.mdc`; the examples: `patterns.md`.

## A new screen or a new area of a screen

1. **The model.** The entities the screen shows and changes are in
   `contract/model.schema.json` with their fields and actions; an action of the platform is
   in the `actions` of `contract/platform.yaml`.
2. **The name.** The screen name is a row of "Screen names in use" in
   `contract/vocabulary.md`, added in the same change.
3. **The screen file** `contract/screens/<pathname>.yaml`, named by its first binding's path
   (nested segments as folders), the editor hint on its first line, keys in the order `id`,
   `title`, `description` (what the screen is for), `flag`, `bindings`, `entry`.
4. **The routes.** `bindings` in TanStack Router's format: `path`, `guard`, `roles`,
   `params` and `search` as flat JSON Schemas, `history`, `retain`. A state a test opens
   directly (a tab, a filter, a selection) is a path or search parameter, so the route is its
   address. A path parameter carries `examples`, fake values it accepts
   (`examples: [ org_01hzx9k2 ]`), so the binding's example link is concrete (one whose
   schema no value can be built for must); check it with `bun run contract:routes`.
5. **The root.** A container that scopes the screen: a page `status`, a `form` or a
   `section`.
6. **The controls.** Every control a test or an agent drives (button, link, input,
   textarea, select, switch, tab), each with the `binding` it runs or shows.
7. **The lists.** The container (`list` or `table`); every entry (`item` or `row`) with
   `dataId`, and its row states when an entry differs or changes in place; the controls of
   an entry; the cells a test reads. A choice that is not an entity has `dataValue`, and each
   fixed value is a row of "Choice values".
8. **The dialogs.** Each one a `ConfirmDialog` mounted with its own `testId` and `code`,
   its buttons in `derived`.
9. **The messages.** Every `error`, `message` and notice a test asserts, with its `codes`,
   each code a row of "Codes".
10. **The states.** `data-state` on every container whose data arrives after the page; the
    screen's `states` say what each state shows.
11. **The rest of the screen.** `entry` (the anchors a test starts from, alternatives by
    state included), the `flow` (an XState machine config: its states, per event on an
    anchor the transition with its `target`, `guard` and effects `show` and `navigate`, an
    `invoke` state per action with its `onDone` and `onError`; `flows-machine.spec.ts` runs
    it in XState) and the `wireframe` (the default state as an aria snapshot).
12. **The scenario.** At least one file under `tests/e2e/scenarios/<entity>/base/` that opens
    the screen, written from the contract alone; `bun run e2e:scaffold <id>` writes its test.
13. **The code.** The module route equals the binding (`routes-contract.spec.ts`) and the
    router round-trips it (`routes-router.spec.ts`); the view renders exactly the anchors of
    the file. An element two render paths draw is one `<NAME>_TEST_ID` constant; an icon-only
    control has an `aria-label` from a translation key.
14. **The checks.** `contract:check`, `contract:check:sources`, `contract:check:consumers`,
    `e2e:coverage`, then `contract:coverage --unmarked` (nothing unmarked) and
    `contract:coverage --write`.
15. **The hand-off.** The output of `bun run contract:diff main` (`templates.md`).

## A new field or action of an entity

1. **The model.** A field goes into the entity's `properties` with its `x-perch` (`readonly`,
   `record`, `crdt`); an action into `x-perch.actions` with its parameters, and the roles
   that may run it into `can`.
2. **Unbound first.** `bun run contract:coverage` lists the new field or action as
   `unbound`: the contract knows it, no screen shows it yet.
3. **The screen file.** An anchor binds it: `binding: { model: <entity>.<field> }`, or
   `{ action: <entity>.<action>, params: { ... } }` with each parameter naming the anchor
   whose value it takes. The codes of its failures go into the anchor's `codes` and the
   vocabulary's "Codes"; its event goes into the `flow` as a transition into a state that
   invokes the action, whose `onError` shows those codes on the anchor that carries them.
4. **The scenario.** A step that uses it and an expected result with a code, a state or a
   value, in brackets.
5. **The code and the tests.** The view renders the anchor; the database side follows its own
   rules (the router `process-check-rules-skills.mdc` points to them). The test asserts the
   code, state or value.
6. **The measure.** `bun run contract:coverage --write` now shows the field or the action
   bound. One left unbound on purpose (an internal id, a creation time) needs no anchor.
7. **The checks and the hand-off** as for a new screen.

## An activity across screens

1. **The model.** What the activity carries from screen to screen and is a field of an
   entity is in `contract/model.schema.json`; what is not (the account signed in) is only
   named in the activity's `data`.
2. **The screens' flows.** Every screen the activity visits has its screen file, and each
   step from one screen to the next is already there: a transition on an anchor whose flow
   reaches a `navigate` to the next screen's path (in its actions, on leaving a state or
   entering one, or after an invoke's `onDone` or `onError`), or a link with
   `binding: { route: <path> }`. A
   step the screens cannot take yet goes into their flows first, never into the activity.
3. **The activity file** `contract/activities/<id>.yaml`, named by its id, the editor hint on
   its first line, keys in the order `id`, `title`, `description`, `roles`, `data`,
   `initial`, `meta`, `states`. A state is a visit to a screen: a dot-free name (`sign-in`,
   `signed-out`), `meta: { screen: <screen id>, address: { path: <a binding of it> } }` on
   one line, `type: final` where the activity ends; one screen may be visited by several
   states. Its `on` lists the anchors of that screen or of the frame that lead to another
   visit, each with its `target`, a `guard` of `meta.guards` when only some cases lead there,
   and a `description`; no effects and no `invoke`.
4. **The scenarios.** Each scenario that walks the activity names it in its front matter,
   `activity: <id>` after `tags`, and names in brackets, in a step, the anchor of each
   transition it takes, after the route of the state it leaves; with several devices, each
   step opens with `On device X,`.
5. **The checks.** `contract:check` holds the activity to the screens, the web app's
   `activities-machine.spec.ts` runs it in XState, and `bun run contract:coverage --write`
   shows how many of its transitions the scenarios walk.
6. **The hand-off** as for a new screen.

## Rewriting a component

1. **Before.** Note the anchors it renders (`git grep` its literals; on the dev stand,
   `window.__perch.ui.anchors()`). The goal is an empty contract diff.
2. **The same elements.** Every anchor stays on the same semantic element; a wrapper that
   goes hands its anchor to the element that stays, never to a new wrapper.
3. **The same forms.** `testId` stays an ordinary prop, derived names stay on `testIdFor`, a
   shared constant stays shared, and a coverage-ignore marker stays right before its element.
4. **After.** `contract:check:sources` passes with no anchor left unrendered,
   `contract:coverage --unmarked` lists no new control, and `bun run contract:diff main`
   prints `contract changes: none`, or the hand-off names each rename with its reason and
   the scenarios and tests changed with it.

## After a merge

A merge can bring controls without anchors, routes the screen files do not describe and
messages without codes, and a conflict resolution can drop an anchor while it keeps the
incoming change.

1. **The conflicts.** Keep the incoming change and the contract attributes of both sides:
   `data-testid`, `data-id`, `data-value`, `data-state`, `data-code`, `aria-label` and the
   coverage-ignore markers. An anchor a resolution dropped is a removal, not a merge detail.
2. **The contract files.** Both sides' screen files, vocabulary rows and model entries are
   kept; the checks then say what does not hold together.
3. **The checks.** The three contract checks and `e2e:coverage`; `bun run contract:diff
   HEAD^1` lists what the merge brought into the contract, and a removed or renamed anchor is
   carried into the scenarios and the tests like any other.
4. **The coverage.** `bun run contract:coverage --unmarked`: every control the merge added
   gets an anchor declared in its screen file, or a marker with its reason.
5. **What came in.** New routes, search parameters, dialogs and messages of the incoming
   side are in the screen files, and its new messages have codes.
6. **The commit.** This audit is a commit of its own after the merge commit, handed over as
   any contract change.

## Changing the coverage method

The counting lives in `packages/ui-contract/src/handoff/controls.ts` (`CONTROL_TAGS`,
`countControls`) and the markers in `packages/ui-contract/src/sources/ignore.ts`; "How it is
counted" in `contract/COVERAGE.md` describes both. A change to either changes what the note
means, so the same change:

1. runs `bun run contract:coverage --unmarked` before and after;
2. gives every element that entered or left the count an anchor or a marker with its reason;
3. updates "How it is counted" and the specs beside the code;
4. rewrites the block with `bun run contract:coverage --write`.
