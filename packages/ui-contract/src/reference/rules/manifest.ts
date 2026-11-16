/**
 * The rules of the manifest: what it holds, how it is built and served, the page helper a
 * development or e2e build installs, and the check of a settled state against what the state
 * renders.
 */

import type { ReferenceRule } from '../rule'

const manifest: ReferenceRule = {
  id: 'manifest',
  title: 'The manifest: what it holds, how it is built and where it is served',
  text: [
    "`bun run contract:manifest` (`ui-contract manifest --out <folder>/ui-manifest`) builds `ui-manifest/manifest.json` from the contract files and the scenarios of `tests/e2e/scenarios/` alone, only after the contract check passes: `emitManifest(root, outDir)` runs the contract check, writes nothing and returns its problems when it finds any, else loads the contract and builds, validates and writes the manifest. `buildManifest` takes only the vocabulary, the screens, the model, the activities, the scenarios and the product. `writeManifest(root, outDir, manifest)` validates it against `contract/schemas/manifest.schema.json` with Ajv and returns the problems without writing anything, or empties `outDir` (its last segment must be `ui-manifest`, `MANIFEST_DIR`, else a problem) and writes `manifest.json` (two spaces deep, each entry of `ids` on one line, so a search for an anchor shows its facts), `manifest.schema.json` and `model.schema.json` beside it. `productInfo(root)` names the product: the root package's version and the commit checked out, or null.",
    'The web build writes it into `apps/web/dist/ui-manifest/` (`bun run build` runs `ui-contract manifest --out dist/ui-manifest` once Vite is done; the development watcher writes it into `apps/web/dist-dev/ui-manifest/` after every build, and a change of a contract file or of a scenario rebuilds), and both stands serve it at `/ui-manifest/manifest.json`, with `manifest.schema.json` and `model.schema.json` beside it and `Cache-Control: no-store`. `PERCH_UI_MANIFEST=0` on a stand answers 404 there; the default, `1`, serves it.',
    "It is what a tool outside the repository reads (its keys are the Manifest section of this reference): the vocabulary as tables with prose `instructions` for an agent (`instructionsOf`, its fixed texts read from the rules of this reference, the anchors and states taken from the vocabulary and the platform section); `derivedParts`, each derived suffix with the kind of the part it marks, the meaning of the suffix as its `description` and, for a `visibility-button`, its values; `composites`, the vocabulary's table of the platform's composites, whose declarations are under `platform.composites`; `fieldStates`, the table of field states, `{}` when the vocabulary has none; the screens verbatim, each binding with its `example` link and each anchor with its description, the written one (a secret input's with `(type password)` appended once) or else the one the engine says (see the rule `engine-descriptions`); the platform section and the activities verbatim, each value of the platform with its length resolved; the scenarios parsed; `routeParams`; the model document, each field's length resolved; from version 6 `contract.defaults`, the default length they took (see the rule `declared-values`); and `ids`.",
    "`ids` lists every declared anchor by name with its kind, its screen and its attributes: `holdsInput` of a field, the `fieldStates` of a field, the `marksState: false` of a field that writes it (the app leaves its border uncoloured; its `fieldStates` still hold), a ranked message's `ranked`, a secret input's `composite`, and `derivedFrom` on the anchors a composite derives (`{ composite }` on its list, `{ composite, item }` on an item), one entry per line, so a search for an anchor in the manifest shows its facts. `fieldStatesOf` gives the states of a field: only an `input`, `textarea` or `select` that holds input has any, `unsaved`, and `saved` too when its binding is a model field; each state must be declared in the vocabulary's \"Field states\" table, so a vocabulary without it gives none; listed only when not empty.",
    'A contract change hands over `bun run contract:diff main` with the reason for each rename or removal (see the rule `hand-over`).',
  ].join('\n\n'),
  keys: [],
}

const pageHelper: ReferenceRule = {
  id: 'page-helper',
  title: 'The page helper and the report of a settled state',
  text: [
    "On a development build, and on a production build made with `PERCH_UI_HOOKS=1` (the e2e stand's), `window.__perch.ui.anchors()` (`PAGE_HELPER`, `__perch.ui`) lists the anchors the page renders now, in document order, each with its kind (the last dash-separated word of its last segment), `data-state`, `data-code`, `data-id`, `data-value` and visibility (`visible` is false when the element or one of its ancestors is hidden), with the page's URL (`RenderedPage`, `RenderedAnchor`). `ANCHOR_ATTRIBUTES` names the attributes (`data-testid`, `data-state`, `data-code`, `data-id`, `data-value`), and `window.__perch` is declared on `Window` for any code that imports the types. Without the helper, the names a page renders are still there:",
    [
      '```js',
      ";[...document.querySelectorAll('[data-testid]')].map((element) => element.dataset.testid)",
      '```',
    ].join('\n'),
    "An e2e run exposes the binding `window.__perchSettledState` (`SETTLED_STATE`, declared on `Window`), and such a build reports to it each settled state of a screen's machine, once the page has rendered it: the screen (`app-shell` for the frame), the state value (XState's, `SettledValue`) and the page as the helper reads it then (`SettledState`). The harness holds every report to the manifest the stand serves (`settledProblems`, see the rule `settled-state`), and a test fails at its end when a state it passed through broke it.",
  ].join('\n\n'),
  keys: [],
}

const settledState: ReferenceRule = {
  id: 'settled-state',
  title: 'The check of a settled state',
  text: [
    "`settledProblems(contract, settled)` is the e2e harness's check of a `SettledState` against the manifest (any `SettledContract`: each screen's `id` and `flow`, and `ids` with each anchor's `screen`, `kind`, `derived`, `roles`, `own`, `dataId`, `states`, `with`, `without` and `derivedFrom`): what the page shows once a screen's machine has settled in a state, held to what that state renders (`meta.renders`, read by `renderedAt`). One line per problem; a screen the contract lacks is one. Rendered means visible to the user: an anchor the state does not render is not visible, absent from the page or hidden on it; one it renders is on the page and visible.",
    "Only the anchors of the screen that render only where listed are held, with their derived parts; the anchors every state renders are not (a message shows when it carries a code, and an error when there is one). Two directions are checked. A visible anchor of the screen that the state does not render is reported (`is visible, but the state does not render it`), whatever the anchor is: this one is never waived, so an anchor with `roles`, `own` or a `dataId` that is visible in a state that does not render it is reported. An anchor the state renders that is missing from the page, or hidden, is reported (`is not on the page, but the state renders it`, `is hidden, but the state renders it`), unless something besides the state decides whether it shows, where the requirement to be present and visible is waived. Data decides for an anchor with `roles` or `own`, an entry of a list (`dataId`), or an anchor nested under one of these. Its own rule decides for a cell (see the rule `empty-cell`), for a list whose entries come from data, any list but a composite's unless its `states` include `loading` or `empty` (see the rule `empty-list`), and for an anchor whose `with` and `without` do not say it shows on the page, or that is rendered in each entry of a list (see the rule `with-without`); so does the rule of an anchor it is nested under or derived from, while that anchor is not visible (the parts of a base that shows follow it). It is waived as well for the parts a page shows on demand: a select's `option`, a composite's `item`, a field's `error-message`, and a paged list's `range`, `previous-link` and `next-link`, which its read decides; the size select shows wherever the list does and is held.",
    'Beside these, an anchor of the screen that says when it shows is held to its entries (`with`, `without`, see the rule `with-without`), and a visible list to its entries (see the rule `empty-list`).',
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.meta.renders',
    'screen.anchors.<name>.roles',
    'screen.anchors.<name>.own',
    'screen.anchors.<name>.with',
    'screen.anchors.<name>.without',
  ],
}

/** The rules of the manifest. */
export const MANIFEST_RULES: readonly ReferenceRule[] = [manifest, pageHelper, settledState]
