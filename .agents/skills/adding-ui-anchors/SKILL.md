---
name: adding-ui-anchors
description: "Add, rename or remove an anchor (data-testid) of the web app, or describe a new screen, contract first: declare it in contract/screens.json by the grammar of contract/vocabulary.md, put the literal on the element, run the contract checks and hand over the contract diff. Use when a view gains a control, list, dialog or screen that a test or an agent must find, or when one cannot find an element."
---

# Adding UI anchors

## Pyramid Layer

- Layer: L1 skill, reached from the rule `.cursor/rules/ui-contract.mdc`, which states the
  contract on one page; this skill is the procedure.

## Use This When

- A view gains a control, a list, an item, a dialog or a message that a test or an agent must
  find, or one is renamed or removed.
- A new screen is described for the modeling thread, or an existing one gains a route.
- An e2e test or an agent cannot find an element: it either has an anchor (step 1 finds it) or
  needs one (steps 2 to 7).

## Stop Here If

- The anchor is declared in `contract/screens.json`, rendered by its literal, reached by a
  scenario with its test, and step 6 is green.

## Descend To

- The rules of the contract: `.cursor/rules/ui-contract.mdc`.
- The grammar and the closed lists: `contract/vocabulary.md`.
- The screens map, locating an element, asking for a missing anchor: `contract/README.md`.

## Steps

1. **Read what exists.** Open the screen in `contract/screens.json` (its `entry`, `anchors`,
   `states` and `flow`). On the dev stand (`mcproc start dev`, a development build), run
   `window.__perch.ui.anchors()` in the page's console: the anchors the page renders now, with
   their kind, `data-state`, `data-code`, `data-id`, `data-value` and visibility. When the
   element already has an anchor, use it and stop.
2. **Name it by the grammar** of `contract/vocabulary.md`: the screen name first, an optional
   middle segment for the part of the screen (`notes`), then `<object>-<kind>` with a kind of
   "Kinds" (`organisation.notes.pin-button`). Check that the name is free:
   `git grep -n '<anchor>' -- apps packages` prints nothing, the name is not declared in
   `contract/screens.json`, and it is not another anchor plus a derived suffix: the entries of
   a container `x.list` are `x.list.<object>-item`, never `x.list.item`.
3. **Declare it in `contract/screens.json`**, the contract first, then the code (on a new
   screen, step 5 comes first: the screen exists in the contract before its anchors): under the
   screen's `anchors`, its `kind`, a `description`, its `binding` (a model field, an action
   with its params, a route, or an array of them), its `codes`, `states`, `dataId` or
   `dataValue`, `derived` suffixes, `roles` and `own` as they apply. A new code, state or
   choice value goes into its table of `contract/vocabulary.md` in the same change; an action
   that does not exist yet goes into the entity's `x-perch.actions` of
   `contract/model.schema.json`, or into `platform.actions`.
4. **Put the literal on the semantic element**, the one whose role the kind maps to (the
   button, not a wrapping `div`), in one of the four forms of the rule. A composite of the kit
   takes the anchor as its `testId` prop and builds each part with
   `testIdFor(testId, '<suffix>')` from `@workspace/ui-contract/anchors`. Carry `data-code`,
   `data-state`, `data-id` or `data-value` as declared; a domain code is mapped to the contract
   code in the presentation layer.
5. **A new screen** adds its name to "Screen names in use" of the vocabulary and a screen to
   `screens.json`: `bindings` in the router's format (`path`, `guard`, `roles`, `params` and
   `search` as flat JSON Schema objects, `history`, `retain`), the module route equal to it
   (`apps/web/src/platform/routes-contract.spec.ts` compares them), the `entry` anchors, the
   `states`, the `flow`, a `wireframe` in Playwright's aria snapshot grammar, and a scenario
   under `scenarios` (`<feature>/<nn>-<slug>`, with `devices`, `steps` and `expected` written
   with bracket references); `bun run e2e:scaffold <scenario id>` writes its test.
6. **Check:**
   `bun run contract:check && bun run contract:check:sources && bun run contract:coverage --write`,
   then `bun run e2e:coverage` when a scenario changed, and `bun run check` before the commit.
7. **Hand over** with the output of `bun run contract:diff main` in the change's description.

## Do not

- Build an anchor at runtime: no template with expressions, no `+`, no conditional inside
  the literal; choose between two literals.
- Join a derived name by hand instead of `testIdFor`.
- Assert or locate by the page's wording; use the anchor, then its code, state, id or value.
- Put a domain or bus code (`note:FORBIDDEN`) into `data-code`.
- Declare or render a reserved anchor of the shell from a feature.
- Declare one anchor on two screens, or mark two elements with one anchor that is not an
  `item`, `row` or `option`.
- Edit the generated `contract/screens.schema.json`, `x-perch.schema.json` or
  `manifest.schema.json` by hand (`model.schema.json` is authored), or copy the vocabulary's tables into another file.
- Change the code before the contract.
