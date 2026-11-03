---
name: adding-ui-anchors
description: "Change what the web app shows or does contract first: the model in contract/domain/model.schema.json, the screen in contract/domain/screens/<pathname>.yaml, the scenario in tests/e2e/scenarios/, then the anchors (data-testid) in the code and the literals in the e2e tests, held together by the three contract checks. Use when a view gains, renames or loses a control, list, dialog, message or screen that a test or an agent must find, when a scenario is written, when a component is rewritten, or when a test or an agent cannot find an element."
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

- The change reached the contract before the code, the developer approved the contract diff
  before the code started, the anchor is rendered by its literal and reached by a scenario with
  its test, and step 8 is green.
- The change is a fix that brings the code back to what the contract already says, correctly:
  no contract diff and no review stop; steps 6 to 8 only.

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

1. **Read what exists.** Open the screen file, `contract/domain/screens/<pathname>.yaml`
   (`__root.yaml` for the frame): its `entry`, `anchors`, `states` and `flow`. On the dev
   stand (`mcproc start dev`), `window.__perch.ui.anchors()` in the page's console lists the
   anchors the page renders now, with their kind, `data-state`, `data-code`, `data-id`,
   `data-value` and visibility. When the element already has an anchor and what the contract
   says of it stays as it is, use it and stop. A change of its behaviour (a transition, a
   state, a guard, a code, a facet) goes on through steps 2 to 5 like a new element.
2. **The model.** A field or an action the screen needs goes into its entity of
   `contract/domain/model.schema.json` (`properties`, `x-perch.actions`), or into the `actions` of
   `contract/domain/platform.yaml` when the platform runs it; a platform action that sends a
   mail declares it under `mail`, and one that sends a mail that only tells, with no token,
   lists it under `notices` (`references/patterns.md`, "A notice mail").
3. **The name.** Follow the grammar of `contract/vocabulary.md`: the screen name, an optional
   segment for the part of the screen, then `<object>-<kind>` with a kind of "Kinds"
   (`organisation.invite.email-input`). The name is free when no screen file declares it,
   `git grep -nF '<anchor>' -- apps packages tests contract` prints nothing, and it is not
   another anchor plus a derived suffix: the entries of a list `x.list` are
   `x.list.<object>-item`, never `x.list.item`.
4. **The screen file.** Declare the anchor under the screen's `anchors`: its `kind`, a
   `description`, its `binding` (the model field, the action with its params, a route, the
   search parameter a field starts with, or a list of them), and its `codes` (an error's `fields` with them: the field each code
   concerns), `states`, `dataId` or `dataValue`, `derived`, `roles` and `own` as they apply.
   Leave out what the contract says elsewhere ("What a screen leaves out" in
   `contract/README.md`): an error's `codes` and `fields` when they are the failures of the
   actions its part binds and of the actions its flow invokes against it, with the codes its
   flow shows on it, the codes of a `show` in an `onError` when they are the failure's,
   the region of a button bound to one action when it only runs the action, and the toast of a
   mutation's success (one per operation, where it ends, a chain of actions named by the control
   that starts it; one event starting several at once is refused; on by default for an action of the
   model, and for a platform action the platform's `toasts` lists; a notice or an error written on the outcome leaves it on; write
   `toast: false` on the invoke, or on a region `by` its button, to ban it, or a `show` on the
   toast for a message of its own), and the question before a destructive action (a control
   bound to a delete, remove or revoke asks the frame's confirmation; write `confirm: false` on
   its anchor to run it without asking). A button may leave out the params the fields of its
   part pass to its action in their own bindings; a param it writes wins over theirs, key by key
   (`user.sign-in.submit-button` binds `platform.sign-in` alone, and `platform.sign-up` with
   `locale: app-shell.locale-select`, which no field passes). A request leaves out its failure:
   an invoke whose action fails with codes clears its part's error on entry and goes back the
   one way it came, on a control, showing the failure there; a state where its area starts,
   one a platform or data event enters, or one with no single way back writes its `onError`,
   and one written as its target alone gets the show on its part's error, else on
   `<screen>.error` (also when no control enters it and its input names no field, as a request
   a link starts). A list the platform declares as a composite is never written: the secret input
   writes `composite: password-rules` in place of the password rule list and its items. A
   `description` the engine says itself is left out too (a heading, a link to a screen, a secret
   input, an error, a composite's anchors), and `bun run contract:coverage --descriptions` lists
   the written ones to drop. Add its
   events to the `flow` (XState's language: see the pattern
   "A machine from the flow"; an area of the screen independent of the others is a region
   of its parallel state, and an event belongs to one area; write it in the shorter forms
   of `contract/README.md` where they fit, a transition as its target, an effect by its
   name, a region by its pattern or by its button, and read the expansion with `bun run
   contract:flow <screen>`) and the element to the `wireframe`. A
   new code, state or choice value goes into its table of the vocabulary in the same change:
   those tables are business, like the screen file. The toast codes the contract derives for
   mutations' successes (an action of the model, or a platform action the platform's `toasts`
   lists) are the exception: the rule row `<object>-<verb>ed` stands for them, and only their
   words are written, in the frame's map. A field holds input by itself; only a
   field whose own change runs its action (a select that applies at once) carries
   `holdsInput={false}` in the JSX, and the contract derives which. A field that holds a
   secret says `secret: true`, and a password input that shows what it holds on demand lists
   `derived: [ visibility-button ]` beside it: the eye is
   presentation only, never an event of the flow (`references/patterns.md`, "A password
   input's eye").
   A new screen follows the checklist in `references/checklists.md`.
5. **The scenario.** Write or change the file
   `tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md` from the contract alone, with
   bracket references; it names a mail by the action that sends it, `[mail:<action>]`, and a
   notice by its action and its name, `[notice:<action>.<name>]`. When it cannot be written from the contract, the scenario has found a
   gap: go back to steps 2 to 4, never work around it in the test. A gap the contract cannot
   close in this change is signalled, never emulated: `.cursor/rules/contract-gap-no-emulation.mdc`.
   **Commit the contract**, each layer on its own branch and no implementation in either
   (the layers and branches of `.cursor/rules/ui-contract.mdc`; the app's runtime of the
   contract and the specs that hold the app to it are the implementation's). A new facet
   first: the meta
   change (`@workspace/ui-contract`, the generated schemas, the vocabulary's grammar, the
   docs about them) goes on `feat/contract-first-pass`, after a merge of the latest `main` into it, and
   lands on `main` as its own squash after the developer's go on those meta commits by hash
   (one round at a time; a commit added after the hand-over needs a new one, and a change its
   review brings is a commit of its own on top, never an amend). Then the business change
   (the screen files, the activities, the platform, the model, the scenarios, the rows of the
   vocabulary's tables) goes on the contract trunk, `contract/trunk`
   (`.cursor/rules/branch-reuse-first.mdc`), in the developer's modeling session, after the
   trunk has merged `main` with that landing: one card's commits, each decision a commit of
   its own on top, never an amend. On the trunk, as on any branch, the hook lets the contract
   run ahead of the app (an anchor declared, not rendered yet, passes; an app's machine may
   lack what its flow added, and does nothing the flow does not say, or is still its flow at
   the branch's base; a scenario may wait for its test, which the landing on `main`
   requires), but it cannot drop a name the app still renders: a rename or a removal keeps the
   old name declared, and the card lists it for the drop after the implementation.
   **Then the review** (the gate of the same rule): show the developer the output of
   `bun run contract:diff main` with the diff, change the contract until they say it is
   right, and note on the card its trunk commits, oldest first, with that OK. Nothing below
   starts before it, not even a test's scaffold. The OK covers the card's commits, and the one
   it approves in advance: the last business commit of a rename or a removal, which drops the
   old names the card listed and nothing else.
   **Then the take**, on the feature's own branch with `main` merged in:
   `git cherry-pick --no-commit <the card's trunk commits, oldest first>`, then one
   `git commit` named for the card's goal, which runs the hook; where a commit of the card
   sits next to another card's lines, the take keeps this card's lines only. The card notes
   the take's hash. A business commit written on the feature's branch instead, a feature
   begun there before the trunk or an amendment the developer allows there, **stops for
   review**: hand the developer the output of `bun run contract:diff main`, the contract
   commits by hash with their diff and the meta landing they build on, the reason for every
   change and the gaps signalled (`references/templates.md`, "Review"), ask for the OK on
   those commits, and wait. A change that review brings (one the developer asks for, or one
   an answer to their question leads to) is a new commit on top of the ones under review,
   never an amend or a re-cut, and the OK is then asked on all of them. Any other contract
   commit made, re-cut, amended or rebased after that OK, even with its files unchanged,
   stops here again, and so does a return to the code after other work.
6. **The code**, after the developer's OK on the contract commits beneath it, in commits of its own (the code, its tests, an
   app machine's entry in `APP_MACHINES`, and an example of a meta doc that quotes the code it
   changes), never with any other business or meta change. Once the code no longer renders a
   renamed or removed name, a last business commit on this branch drops it from the
   contract: the OK of step 5 approved it, so it needs no new stop. Any other contract change
   found from here on goes back to steps 2 to 5 on the trunk and is taken as one more commit;
   a meta one goes through `feat/contract-first-pass` and its landing, then `main` is merged
   into the trunk and into this branch. Put the literal on the semantic element, in one of the four
   forms. A
   composite takes `testId` and derives its parts with `testIdFor`. Carry `data-code`,
   `data-state`, `data-id` or `data-value` as declared, with a domain code mapped to the
   contract code in the presentation layer. An icon-only control also gets an `aria-label`.
   A control that is not a test target gets a coverage-ignore marker with its reason.
   `references/patterns.md` has one example per case.
7. **The tests.** `bun run e2e:scaffold <id>` writes the failing test of a new scenario. The
   test of the scenario locates by anchors and asserts codes, states and values, never
   wording.
8. **Check:**

   ```sh
   bun run contract:check && bun run contract:check:sources && bun run contract:check:consumers
   bun run e2e:coverage
   bun run contract:coverage --unmarked
   bun run contract:coverage --write
   ```

   Then `bun run check` before the commit.
9. **Hand over** the finished change: the output of `bun run contract:diff main` with the
   reason for each rename or removal (`references/templates.md`, "Hand-off"). This is the
   delivery; the review of step 5 came before the code.

## Do not

- Start in JSX or in a test: an anchor, a code, a state or a route is in the contract first.
- Emulate a facet the contract lacks in a component, a hook, a store or a test; signal the gap
  as `contract-gap-no-emulation.mdc` says.
- Invent a kind, a suffix, a state, a code or a value outside the vocabulary; add it to its
  table in the same change (a derived toast code has the rule row already).
- Build an anchor at runtime, join a derived name by hand instead of `testIdFor`, or write
  one literal twice; pass it as a prop or share a `<NAME>_TEST_ID` constant.
- Put an anchor on a wrapper, a fragment, a portal or a backdrop, or use an `id` attribute in
  place of an anchor.
- Hold text, a colour, a position or an entity's id in an anchor.
- Assert or locate by the page's wording, a CSS class or the shape of the DOM.
- Put a domain or bus code (`note:FORBIDDEN`) into `data-code`.
- Declare or render a reserved anchor of the shell from a feature.
- Edit a generated schema in `contract/schemas/` (`screen.schema.json`,
  `platform.schema.json`, `activity.schema.json`, `x-perch.schema.json`,
  `manifest.schema.json`) by hand, or copy
  the vocabulary's tables into another file.
- Strip anchors from any build.
