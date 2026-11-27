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
- Every key and rule of the contract, each written once: `contract/REFERENCE.md`, generated.
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
   `contract/domain/platform.yaml` when the platform runs it. A platform action that sends a
   mail declares it under `mail`, and one that sends a mail that only tells lists it under
   `notices` (`contract/REFERENCE.md#rule-check-platform`; `references/patterns.md`, "A notice
   mail"). Every action, of the platform or of the model, declares the reads it changes under
   `changes`, `[]` for none (`contract/REFERENCE.md#rule-read-after-an-action`,
   `contract/REFERENCE.md#platform-actions-name-changes`). A platform action writes its
   `result` as outcome lines and each code with the condition it answers on; a rule several
   actions keep is an invariant of `platform.invariants`, named under its code by each of them
   and never restated (`contract/REFERENCE.md#rule-action-outcomes`).
3. **The name.** Follow the grammar of `contract/vocabulary.md`: the screen name, an optional
   segment for the part of the screen, then `<object>-<kind>` with a kind of "Kinds"
   (`organisation.invite.email-input`; `contract/REFERENCE.md#rule-anchor-grammar`). The name
   is free when no screen file declares it, `git grep -nF '<anchor>' -- apps packages tests
   contract` prints nothing, and it is not another anchor plus a derived suffix.
4. **The screen file.** Declare the anchor under the screen's `anchors`: its `kind`, a
   `description` (what the element is for, in 200 characters at most), its `binding` and, as
   they apply, its other keys: `codes`, `ranked`, `states`, `dataId` or `dataValue`, `derived`,
   `roles` and `own` (each key's text is in `contract/REFERENCE.md#screen-anchors-name-binding`,
   `contract/REFERENCE.md#screen-anchors-name-description`,
   `contract/REFERENCE.md#screen-anchors-name-codes`,
   `contract/REFERENCE.md#screen-anchors-name-ranked`,
   `contract/REFERENCE.md#screen-anchors-name-states`,
   `contract/REFERENCE.md#screen-anchors-name-derived`,
   `contract/REFERENCE.md#screen-anchors-name-roles` and
   `contract/REFERENCE.md#screen-anchors-name-own`). Add its events to the `flow` and the element
   to the `wireframe`. A new code, state or choice value goes into its table of the vocabulary in
   the same change: those tables are business, like the screen file.
   Leave out what the contract says elsewhere ("What a screen leaves out" in
   `contract/README.md`), and write only what a tester or a user can tell apart:
   - the failure of a request, an error's codes and fields, and what a `show` in an `onError`
     takes: `contract/REFERENCE.md#rule-error-codes-and-fields`,
     `contract/REFERENCE.md#rule-failure-show`, `contract/REFERENCE.md#rule-request-outcome`;
   - the region of a button, a button's params, and the toast of a success (`toast: false` bans
     it): `contract/REFERENCE.md#rule-button-region`, `contract/REFERENCE.md#rule-button-params`,
     `contract/REFERENCE.md#rule-success-toast`;
   - the question before a destructive action (`confirm: false` runs it without asking) and the
     question before a leave that would lose unsaved input:
     `contract/REFERENCE.md#rule-destructive-question`,
     `contract/REFERENCE.md#rule-leave-questions`;
   - what a list reads and when (`source`, `paged`, `read: <list>` or `read: false` on the
     outcome of an invoke, never a description that says a read; the read after a success is
     mandatory): `contract/REFERENCE.md#rule-list-reads`,
     `contract/REFERENCE.md#rule-paged-list`, `contract/REFERENCE.md#rule-read-after-an-action`;
   - the list of a composite of the platform (`composite: password-rules` on the secret input)
     and a `description` the engine says itself: `contract/REFERENCE.md#rule-composite-of-the-platform`,
     `contract/REFERENCE.md#rule-engine-descriptions` (`bun run contract:coverage --descriptions`
     lists the written ones to drop).

   Write the `flow` in XState's language (`references/patterns.md`, "A machine from the flow"),
   in the shorter forms where they fit, and read the expansion with `bun run contract:flow
   <screen>`: states, events and guards, effects, invoke and what a state renders are in
   `contract/REFERENCE.md#rule-flow-states`, `contract/REFERENCE.md#rule-flow-events`,
   `contract/REFERENCE.md#rule-flow-effects`, `contract/REFERENCE.md#rule-flow-invoke`,
   `contract/REFERENCE.md#rule-flow-shorter-forms` and `contract/REFERENCE.md#rule-renders`
   (`references/patterns.md`, "What a state renders" and "A guard by failure code"). A toast
   code the contract derives is written only in the frame's map (`contract/REFERENCE.md#rule-success-toast`).
   Whether a field holds input is derived (`contract/REFERENCE.md#rule-field-holds-input`), a
   field's state colour is turned off with `marksState: false`, never on a form
   (`contract/REFERENCE.md#screen-anchors-name-marksstate`); these and the limit and the type
   of a text field are the contract's, and a view writes none of them: the kit takes them from the
   generated field facts, and the sources check refuses a view that does
   (`contract/REFERENCE.md#rule-check-sources`, `contract/REFERENCE.md#rule-emitted-modules`);
   a field that must be filled before its form's press is taken says `required: true`, the field
   facts carry it to the kit, and a view writes no `required` either
   (`contract/REFERENCE.md#rule-required-field`);
   a field that holds a secret says `secret: true`, and the loader derives its `visibility-button`
   from version 4 (a file of version 3 or below may list `derived: [ visibility-button ]`;
   `contract/REFERENCE.md#rule-kind-parts`, `contract/REFERENCE.md#rule-visibility-button`;
   `references/patterns.md`, "A password input's eye").
   A new screen follows the checklist in `references/checklists.md`.
5. **The scenario.** Write or change the file
   `tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md` from the contract alone, with
   bracket references: a place by its screen's id, `[screen:<screen>]`, never by its path (only a
   screen's further binding, which no id names, is written `[/path]`);
   write the anchor first, then its code, state or value
   (`contract/REFERENCE.md#rule-scenario-brackets`,
   `contract/REFERENCE.md#rule-scenario-format`). When it cannot be written from the contract,
   the scenario has found a gap: go back to steps 2 to 4, never work around it in the test. A gap
   the contract cannot close in this change is signalled, never emulated:
   `.cursor/rules/contract-gap-no-emulation.mdc`.
   **Commit the contract**, each layer on its own branch and no implementation in either
   (the layers and branches of `.cursor/rules/ui-contract.mdc`;
   `contract/REFERENCE.md#rule-layers-and-commits`). A new facet first: the meta change goes on
   `feat/contract-first-pass`, after a merge of the latest `main` into it, and
   lands on `main` as its own squash after the developer's go on those meta commits by hash
   (one round at a time; a commit added after the hand-over needs a new one, and a change its
   review brings is a commit of its own on top, never an amend). Then the business change
   (the screen files, the activities, the platform, the model, the scenarios, the rows of the
   vocabulary's tables) goes on the contract trunk, `contract/trunk`
   (`.cursor/rules/branch-reuse-first.mdc`), in the developer's modeling session, after the
   trunk has merged `main` with that landing: one card's commits, each decision a commit of
   its own on top, never an amend; the hook refuses a commit there that stages a file outside
   the business layer (`contract/REFERENCE.md#rule-trunk-commits`). On the trunk, as on any
   branch, the hook lets the contract run ahead of the app, but it cannot drop a name the app
   still renders: a rename or a removal keeps the old name declared, and the card lists it for
   the drop after the implementation (`contract/REFERENCE.md#rule-ahead-mode`).
   **Then the review** (the gate of the same rule): show the developer the output of
   `bun run contract:diff main` with the diff, change the contract until they say it is
   right, and note on the card its trunk commits, oldest first, with that OK. Nothing below
   starts before it, not even a test's scaffold. The OK covers the card's commits, and the one
   it approves in advance: the last business commit of a rename or a removal, which drops the
   old names the card listed and nothing else.
   **Then the take**, on the feature's own branch with `main` merged in:
   `git cherry-pick --no-commit <the card's trunk commits, oldest first>`, then
   `git commit -m "<type>(contract): <the card's goal>" -m "Taken-from: contract/trunk <first>^..<last> <card>"`,
   which runs the hooks (the commit-msg hook holds that form,
   `contract/REFERENCE.md#rule-take-form`). The card notes the take's hash.
   A business commit written on the feature's branch instead, a feature begun there before
   the trunk or an amendment the developer allows there, takes the same subject with
   `Written-on-branch: <card>` in place of the take's trailer, and **stops for review**: hand the developer the output of `bun run contract:diff main`, the contract
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
   into the trunk and into this branch. Put the literal on the semantic element, in one of the
   four forms, and derive a composite's parts with `testIdFor`
   (`contract/REFERENCE.md#rule-anchor-grammar`); carry `data-code`, `data-state`, `data-id` or
   `data-value` as declared, a domain code mapped to the contract code in the presentation layer
   (`contract/REFERENCE.md#rule-attributes`, `contract/REFERENCE.md#rule-field-states-carried`);
   a control that is not a test target gets a coverage-ignore marker with its reason, and an
   icon-only control an `aria-label` (`contract/REFERENCE.md#rule-marking-a-page`,
   `contract/REFERENCE.md#rule-check-sources`). `references/patterns.md` has one example per
   case.
7. **The tests.** `bun run e2e:scaffold <id>` writes the failing test of a new scenario. The
   test of the scenario locates by anchors and asserts codes, states and values, never
   wording (`contract/REFERENCE.md#rule-scenario-tests`).
8. **Check:**

   ```sh
   bun run contract:check && bun run contract:check:sources && bun run contract:check:consumers
   bun run e2e:coverage
   bun run contract:coverage --unmarked
   bun run contract:coverage --write
   ```

   Then `bun run check` before the commit (`contract/REFERENCE.md#rule-checks`).
9. **Hand over** the finished change: the output of `bun run contract:diff main` with the
   reason for each rename or removal (`references/templates.md`, "Hand-off"). This is the
   delivery; the review of step 5 came before the code.

## Do not

- Start in JSX or in a test: an anchor, a code, a state or a route is in the contract first.
- Emulate a facet the contract lacks in a component, a hook, a store or a test; signal the gap
  as `contract-gap-no-emulation.mdc` says.
- Invent a kind, a suffix, a state, a code or a value outside the vocabulary; add it to its
  table in the same change (a derived toast code has the rule row already).
- Build an anchor at runtime, join a derived name by hand instead of `testIdFor`, write one
  literal twice, or hold text, a colour, a position or an entity's id in an anchor
  (`contract/REFERENCE.md#rule-anchor-grammar`).
- Put an anchor on a wrapper, a fragment, a portal or a backdrop, use an `id` attribute in place
  of an anchor, assert or locate by the page's wording, a CSS class or the shape of the DOM, or
  declare or render a reserved anchor of the shell from a feature
  (`contract/REFERENCE.md#rule-marking-a-page`).
- Put a domain or bus code (`note:FORBIDDEN`) into `data-code` (`contract/REFERENCE.md#rule-attributes`).
- Edit a generated schema in `contract/schemas/` or `contract/REFERENCE.md` by hand, or copy the
  vocabulary's tables into another file (`contract/REFERENCE.md#rule-layers-and-commits`).
- Strip anchors from any build.
