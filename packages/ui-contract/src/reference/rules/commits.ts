/**
 * The kinds of commit the contract is changed by, the ahead mode that lets the contract run ahead
 * of the app on a branch, and what the hooks hold a commit to on the contract trunk, on a branch
 * and on `main`.
 */

import type { ReferenceRule } from '../rule'

const layersAndCommits: ReferenceRule = {
  id: 'layers-and-commits',
  title: 'The business and the meta layer: three kinds of commit',
  text: [
    "The contract has a business layer and a meta layer. The business layer is the entry point of every business feature: `contract/domain/` (the screens, the activities, the platform, the model), the scenarios of `tests/e2e/scenarios/`, and the content tables of `contract/vocabulary.md` (the codes, the states, the choice values, the screen names, the roles, the shell's reserved anchors): a row of them travels with the screen file that first uses it. The meta layer is the engine that keeps the contract working: `@workspace/ui-contract` (its schemas, checks, manifest, runtime helpers, and `./machines`, the walk that runs every flow and activity in XState inside `contract:check` and the comparison an app holds its own machines to their flows with), the generated `contract/schemas/` and `contract/REFERENCE.md`, the grammar of `contract/vocabulary.md` (its Grammar section, the kinds, the derived suffixes, the attributes), `contract/README.md`, the rules and skills about the contract, the contract steps of the pre-commit hook, the prose of `COVERAGE.md` and the contract's rows of `docs/agents/context-smoke-test.md`.",
    "An app is one consumer of the engine, a particular case: its code and its tests are the implementation, its runtime of the contract (`window.__perch.ui`, the served manifest) and the specs that hold it to the contract included (the web app's `apps/web/src/platform/machines.spec.ts` with its `APP_MACHINES`, `routes-*.spec.ts`, the e2e spec of the manifest), and so is an example in a meta doc that quotes the app's code, which changes in the implementation commit that changes that code. A meta commit touches an app only where the app consumes what the engine changed (an import path, a call), never what the app does. On a branch a commit holds one of the three kinds, never two. A feature that needs a new facet lands the meta change first (the engine learns it), then commits the business change that uses it. The generated block of `COVERAGE.md` goes with whichever commit changed what it measures, on an area branch: it measures the code too, so the contract trunk leaves it to the implementation that follows the take; `contract:coverage:check` fails a block that is not what `contract:coverage --write` writes, in `bun run check` and in the hook on `main`.",
    "The files are of two kinds. Authored: `contract/vocabulary.md`, `contract/domain/screens/<pathname>.yaml` (`__root.yaml` for the frame), `contract/domain/platform.yaml`, `contract/domain/model.schema.json`, `contract/domain/activities/<id>.yaml`. Generated, never edited by hand: `screen.schema.json`, `platform.schema.json`, `activity.schema.json`, `x-perch.schema.json`, `manifest.schema.json` and `contract/REFERENCE.md` (`bun run contract:schemas`) and the block of `contract/COVERAGE.md`. A word the vocabulary lacks is added to it in the same change. `isBusinessFile(path)` says whether a file is one of the business layer's (a domain file, the vocabulary or a scenario): the only files a commit on the contract trunk may stage.",
  ].join('\n\n'),
  keys: [],
}

const aheadMode: ReferenceRule = {
  id: 'ahead-mode',
  title: 'Ahead mode: the contract runs ahead of the app on a branch',
  text: [
    "On a branch the pre-commit hook runs the sources check as `contract:check:sources:ahead`, which lets the contract run ahead of the app: an anchor declared, not rendered yet, passes, and so does a facet of a control's element (`aria-invalid`, `disabled`) not written yet, or still written in its idiom on a field or a control the contract has just stopped calling for it on (an error's code moved off a field, a control's event dropped); the app uses only what the contract declares. A `holdsInput`, a `marksState`, a `maxLength` or a `type` a view writes is refused in ahead mode as in the full check (see the rule `check-sources`): the kit takes them from the generated field facts. A commit on `main` and `bun run check` take the full check, `e2e:coverage` and `contract:coverage:check` included, so nothing lands unrendered, half-built, untested or with its coverage block behind.",
    "The same holds for the app's machines: on a branch the hook runs the unit tests with `CONTRACT_AHEAD=1`, and a machine may lack what its flow added (a state, an event, a guarded branch, an effect, an anchor a state renders) but does nothing the flow does not say, or is still exactly its screen's flow at the branch's merge base with `main` (`CONTRACT_AHEAD_BASE`; during a merge, the base the merge's commit will have, so a merge of `main` compares the app it brings with the flows it brings) or at the commit the branch is at (`CONTRACT_AHEAD_HEAD`, the contract the app was built from: a card's second business commit, taken onto a branch whose app already follows its first, changes a flow the base may not have at all; during a merge, the tip before it, unless the engine the merge brings cannot load that tip's contract for any reason, a key it now requires among them, and then that tip gives no flows to match), so a business commit may change a transition the app has not changed yet. `aheadOf(app, flow)` is the flow as far as a machine that lags it has come (equal to the machine's projection exactly when it does nothing the flow does not say) and `laggingOf(app, flow, base)` the flow at the branch's base when the machine is still exactly that, else `aheadOf`.",
    "The app's routes likewise: a binding may wait for its route, and a route that still reads as its binding did at the merge base (the same screen, the same path) is held to that binding as it was there. A scenario may wait for its test, as the hook leaves `e2e:coverage` out on a branch. The hook names both commits, and the cache of the unit tests keys on them, so a pass never carries into another branch state with the same files. A branch whose merge base with a local `main` cannot be found fails the hook; on `main`, on a detached HEAD and in `bun run check` every machine is its whole flow. A contract at an older version, as the hook's ahead mode reads main's (`CONTRACT_AHEAD_BASE`) with the new engine, loads and checks as before (see the rule `editions-and-migrations`).",
    'A rename or a removal keeps the old name declared until the implementation has switched to the new name or stopped rendering the removed element, then a last business commit drops it. It therefore goes in three commits: the business commit adds the new name and keeps the old one (on the trunk, or with the review stop on an area branch), the implementation switches to it, a last business commit on the area branch drops the old one, approved with the first. The ahead mode cannot drop a name the app still renders.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.holdsInput', 'screen.anchors.<name>.marksState'],
}

const trunkCommits: ReferenceRule = {
  id: 'trunk-commits',
  title: 'The contract trunk holds a commit to the business layer',
  text: [
    "On `contract/trunk` the pre-commit hook first holds each commit to the business layer (`scripts/contract-trunk.ts`): a commit that stages a file outside `contract/domain/`, `contract/vocabulary.md` and `tests/e2e/scenarios/`, added, changed or deleted, a move counted by both its paths, fails, naming each such file and the branch it belongs on. The vocabulary counts whole, so an edit of its grammar there is the review's to see in the trunk's diff; a merge passes, as it brings `main` in with every layer.",
    'The pre-commit hook first refuses a commit while a hook `lefthook.yml` names is not installed (`scripts/hooks-installed.ts`): lefthook installs the hooks on `bunx lefthook install` (or `bun install`), and by itself on a hook run that notices `lefthook.yml` changed (an edit in the same second as the last install can pass unnoticed), unless told not to (`--no-auto-install`), but a hook whose file went while `lefthook.yml` stayed the same stays missing.',
  ].join('\n\n'),
  keys: [],
}

const takeForm: ReferenceRule = {
  id: 'take-form',
  title: 'A take: the form of a business commit on a branch',
  text: [
    "On any other branch but `main` and `feat/contract-first-pass` (an experiment's aside), the commit-msg hook holds a commit that changes the business layer to a take's form (`scripts/contract-take.ts`): its subject `<type>(contract): <the card's goal>`, the business layer alone, and as its last paragraph `Taken-from: contract/trunk <first>^..<last> <card>`, each commit or run of them oldest first, on the trunk's own line, changing every file it stages; a business commit the rules let the branch write itself (the last one of a rename or a removal, a feature begun there before the trunk, an amendment allowed there) names its cards in `Written-on-branch: <card>` instead. Nothing else there names the `contract` scope, so `git log main..<branch> -E --grep='^[a-z]*\\(contract\\):'` lists the branch's contract changes (`main..` leaves out the meta rounds `main` brings in) and `--grep='^Taken-from:'` its takes. A plain cherry-pick or rebase runs no hook and a revert of a take fails it.",
    "The check reads the `git commit` that runs the hook from `/proc`, its options parsed as git parses them: an amend is judged as the whole commit it leaves, and the message as git records it, cut at its scissors line under `--verbose` and its comment lines stripped or kept by the cleanup mode; where git's default mode leaves that to whether an editor opened, a message its comment lines change fails, and so does one the comment characters git may pick under `core.commentChar=auto` read differently. Without `/proc` (another system), an amend is judged by what it adds and the message is cut at a scissors line it holds. A take is checked against `main` and `contract/trunk` as the clone knows them, the remote's when it has no branch of its own.",
  ].join('\n\n'),
  keys: [],
}

const landingForm: ReferenceRule = {
  id: 'landing-form',
  title: 'A landing on main: the squash of one branch',
  text: [
    "On `main` the same hook judges every commit as a landing (`scripts/contract-take.ts`), the squash of one branch, against its parent: `main`'s HEAD, or, for an amend, the commit under the one it replaces. A merge into `main` is refused, as `main` takes only squashes; any other commit carries exactly one `Squashed-from: <branch> (<tip>) [<cards>]` trailer as its last paragraph, the cards optional for the hook (the landing procedure still names the card). The branch must exist by its exact ref, `refs/heads/<branch>`, so a revision such as `feat/me~0` names none; the tip, 7 to 40 hex digits, must be that branch's tip or one of its ancestors, and a short id git cannot tell from another commit is refused. The parent must lie under the tip, and the committed tree must equal the tip's tree and differ from the parent's, so a landing is `git merge --squash <branch>` and nothing more or less.",
    "Then the branch's round is judged: the commits of the tip that are neither on the parent nor under the tip of an earlier landing's trailer, merges left out, each against the take rules above as git recorded it, its message and the files it changes. A recorded commit of the round that breaks the take rules stops the squash even when its own hook was skipped (a plain cherry-pick, a `--no-verify` commit). The refusal names each commit that fails and how to rewrite it; the check grants no waiver. `contract/trunk` and an experiment never land, an experiment being split into area branches first. The engine's branch, `feat/contract-first-pass`, is bound by the trailer like any other branch, but its round is not judged, as its meta commits carry the `contract` scope with the engine's own files. `bun run scripts/contract-take.ts --round [<branch>]` prints that verdict for a branch (the checked-out one by default) without writing anything, so it runs before the gates; it ends with `contract take: every commit of <branch> since its last landing (<n>) is in its form` when every commit of the round is.",
    "The check has limits. It sees a commit only where git runs the commit-msg hook for it: a change of `main` that runs none is not seen, a fast-forward, a plain cherry-pick or revert, a rebase, or a commit made with `--no-verify`, the squash's own included. `main` changes only by a squash commit, by procedure, and the check cannot force it. A merge's own resolution is not judged, as a merge of the round is left out. Without `/proc` (another system) an amend is not detected, so the commit is judged against HEAD, and an amend that adds no change to `main` is refused as not changing it. An earlier landing's tip that the clone lacks cannot bound the round: its commits are judged again, and a refusal names those tips, so that the branch which landed them can be fetched. An amend of a landing is made before its merge back into the branch: after it, the replaced landing falls into the round and is judged there.",
  ].join('\n\n'),
  keys: [],
}

/** The rules of the kinds of commit, the ahead mode and the hooks. */
export const COMMIT_RULES: readonly ReferenceRule[] = [
  layersAndCommits,
  aheadMode,
  trunkCommits,
  takeForm,
  landingForm,
]
