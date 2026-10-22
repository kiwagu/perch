---
name: adding-ui-anchors
description: "Change what the web app shows or does contract first: the model in contract/model.schema.json, the screen in contract/screens/<pathname>.yaml, the scenario in tests/e2e/scenarios/, then the anchors (data-testid) in the code and the literals in the e2e tests, held together by the three contract checks. Use when a view gains, renames or loses a control, list, dialog, message or screen that a test or an agent must find, when a scenario is written, when a component is rewritten, or when a test or an agent cannot find an element."
---

# Adding UI anchors

## Pyramid Layer

- Layer: L1 skill, the procedure of the rule `.cursor/rules/ui-contract.mdc`, which states the
  contract on one page.

## Use This When

- A field or an action of an entity reaches a screen, or a screen gains, renames or loses a
  control, a list, an entry, a dialog, a message or a route.
- A new screen is described for the modeling thread.
- A scenario is written, or a test or an agent cannot find an element: either it has an
  anchor (step 1 finds it) or the contract lacks one (steps 2 to 9).
- A component is rewritten and must keep its anchors.

## Stop Here If

- The change reached the contract before the code, the anchor is rendered by its literal and
  reached by a scenario with its test, and step 8 is green.

## Descend To

- The rule on one page: `.cursor/rules/ui-contract.mdc`.
- The grammar and the closed lists (kinds, suffixes, attributes, states, codes, choice
  values, screen names, roles, reserved anchors): `contract/vocabulary.md`.
- One example per situation, from our kit and views: `references/patterns.md`.
- A new screen, a new field or action, an activity across screens, rewriting a component,
  after a merge, changing the coverage method: `references/checklists.md`.
- The request (tester to developer) and the hand-off (the contract diff with its reasons):
  `references/templates.md`.
- The folder, the screen files, the scenarios, the checks, the manifest and coverage for
  people: `contract/README.md`. The tooling: `packages/ui-contract/README.md`.

## Steps

The contract comes first. Completeness comes from the model, the screen unfolds it, and the
code and the tests follow; the checks hold them to the contract.

1. **Read what exists.** Open the screen file, `contract/screens/<pathname>.yaml`
   (`__root.yaml` for the frame): its `entry`, `anchors`, `states` and `flow`. On the dev
   stand (`mcproc start dev`), `window.__perch.ui.anchors()` in the page's console lists the
   anchors the page renders now, with their kind, `data-state`, `data-code`, `data-id`,
   `data-value` and visibility. When the element already has an anchor, use it and stop.
2. **The model.** A field or an action the screen needs goes into its entity of
   `contract/model.schema.json` (`properties`, `x-perch.actions`), or into the `actions` of
   `contract/platform.yaml` when the platform runs it.
3. **The name.** Follow the grammar of `contract/vocabulary.md`: the screen name, an optional
   segment for the part of the screen, then `<object>-<kind>` with a kind of "Kinds"
   (`organisation.invite.email-input`). The name is free when no screen file declares it,
   `git grep -nF '<anchor>' -- apps packages tests contract` prints nothing, and it is not
   another anchor plus a derived suffix: the entries of a list `x.list` are
   `x.list.<object>-item`, never `x.list.item`.
4. **The screen file.** Declare the anchor under the screen's `anchors`: its `kind`, a
   `description`, its `binding` (the model field, the action with its params, a route, or a
   list of them), and its `codes`, `states`, `dataId` or `dataValue`, `derived`, `roles` and
   `own` as they apply. Add its events to the `flow` (XState's language: see the pattern
   "A machine from the flow") and the element to the `wireframe`. A
   new code, state or choice value goes into its table of the vocabulary in the same change.
   A new screen follows the checklist in `references/checklists.md`.
5. **The scenario.** Write or change the file
   `tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md` from the contract alone, with
   bracket references. When it cannot be written from the contract, the scenario has found a
   gap: go back to steps 2 to 4, never work around it in the test.
   `bun run e2e:scaffold <id>` writes the failing test of a new scenario.
6. **The code.** Put the literal on the semantic element, in one of the four forms. A
   composite takes `testId` and derives its parts with `testIdFor`. Carry `data-code`,
   `data-state`, `data-id` or `data-value` as declared, with a domain code mapped to the
   contract code in the presentation layer. An icon-only control also gets an `aria-label`.
   A control that is not a test target gets a coverage-ignore marker with its reason.
   `references/patterns.md` has one example per case.
7. **The tests.** The test of the scenario locates by anchors and asserts codes, states and
   values, never wording.
8. **Check:**

   ```sh
   bun run contract:check && bun run contract:check:sources && bun run contract:check:consumers
   bun run e2e:coverage
   bun run contract:coverage --unmarked
   bun run contract:coverage --write
   ```

   Then `bun run check` before the commit.
9. **Hand over** the output of `bun run contract:diff main` with the reason for each rename
   or removal (`references/templates.md`).

## Do not

- Start in JSX or in a test: an anchor, a code, a state or a route is in the contract first.
- Invent a kind, a suffix, a state, a code or a value outside the vocabulary; add it to its
  table in the same change.
- Build an anchor at runtime, join a derived name by hand instead of `testIdFor`, or write
  one literal twice; pass it as a prop or share a `<NAME>_TEST_ID` constant.
- Put an anchor on a wrapper, a fragment, a portal or a backdrop, or use an `id` attribute in
  place of an anchor.
- Hold text, a colour, a position or an entity's id in an anchor.
- Assert or locate by the page's wording, a CSS class or the shape of the DOM.
- Put a domain or bus code (`note:FORBIDDEN`) into `data-code`.
- Declare or render a reserved anchor of the shell from a feature.
- Edit a generated schema (`screen.schema.json`, `platform.schema.json`,
  `activity.schema.json`, `x-perch.schema.json`, `manifest.schema.json`) by hand, or copy
  the vocabulary's tables into another file.
- Strip anchors from any build.
