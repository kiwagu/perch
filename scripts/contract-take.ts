/**
 * Holds a business commit on an area branch to the form of a take from the contract trunk. The UI
 * contract's business layer (`isBusinessFile`: the domain files, the vocabulary, the scenarios) is
 * modelled on `contract/trunk`, and an area branch takes a card's trunk commits as one commit,
 * `<type>(contract): <the card's goal>`, with the trailer `Taken-from: contract/trunk <commits>
 * <cards>` as its last paragraph: the commits oldest first, each a commit or a run
 * `<first>^..<last>` as `git log` reads it. A business commit the rules let the branch write itself
 * (the last one of a rename or a removal, a feature begun there before the trunk, an amendment the
 * developer allows there) carries `Written-on-branch: <cards>` instead. Nothing else on the branch
 * names the `contract` scope, so `git log main..<branch> -E --grep='^[a-z]*\(contract\):'` lists
 * every contract change of the branch, and `--grep='^Taken-from:'` its takes.
 *
 * A commit that changes the business layer without that form fails, naming the files, and so does
 * one in that form that stages any other file, names its source in no trailer or in two, or
 * writes a trailer git does not read as one. A take's commits must lie on the trunk's own line
 * (its first parents since `main`), a run's first not after its last and each before the next,
 * and every file the take stages must be one they change: what the take needs beyond them goes to
 * the trunk under the card, taken as one more commit. A conflict resolved in a file they change
 * passes. A commit that stages nothing, apart from an amend, is judged by its message. Whether the
 * commit amends and how git cleans its message up are read from the `git commit` running the hook
 * (`takes/command.ts`): an amend is judged as the whole commit it leaves, against HEAD's parent,
 * the amend of a merge passing as the merge it stays, and the message as git records it.
 * Commits on `main`, the trunk, the engine's branch and an experiment, on a detached HEAD, and a
 * merge pass at once; a commit whose branch, files or message git cannot tell fails.
 *
 * Usage: bun run scripts/contract-take.ts <the message file>, from the commit-msg hook.
 */

import { headRef } from './gates/tree.ts'
import { git, merging, stagedFiles } from './staged-commit.ts'
import { commitCommand, readMessage, takeRefusal } from './takes/index.ts'

/** Branches whose commits are no area's: `main`, the trunk and the contract engine's branch. */
const OWN_LAYERS = new Set([
  'refs/heads/main',
  'refs/heads/contract/trunk',
  'refs/heads/feat/contract-first-pass',
])

/** An experiment's business commits go to the trunk when it is split. */
const EXPERIMENTS = 'refs/heads/experiment/'

/**
 * What an amend's commit is judged against: HEAD's parent, the empty tree for a first commit, or
 * `merge` for a merge, which stays one; undefined when git cannot tell.
 */
function amendBase(): string | undefined {
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD'])

  if (parents.status !== 0) {
    return undefined
  }

  const [, first, second] = parents.out.trim().split(' ')

  if (second !== undefined) {
    return 'merge'
  }

  if (first !== undefined) {
    return first
  }

  const empty = git(['hash-object', '-t', 'tree', '--stdin'], '')

  return empty.status === 0 ? empty.out.trim() : undefined
}

function main(): number {
  const [file] = process.argv.slice(2)
  const head = headRef()

  if (head === undefined) {
    console.error('contract take: git cannot tell the branch this commit is on.')

    return 1
  }

  if (head === '' || OWN_LAYERS.has(head) || head.startsWith(EXPERIMENTS) || merging()) {
    return 0
  }

  const command = commitCommand()
  const base = command.amend ? amendBase() : 'HEAD'

  if (base === 'merge') {
    return 0
  }

  const files = base === undefined ? undefined : stagedFiles(base)
  const message = file === undefined ? undefined : readMessage(file, command.cleanup)

  if (files === undefined || message === undefined) {
    console.error(
      'contract take: git cannot list the files this commit stages, or read its message.',
    )

    return 1
  }

  const refusal = takeRefusal(head.slice('refs/heads/'.length), message, files)

  if (refusal === undefined) {
    return 0
  }

  console.error(refusal)

  return 1
}

process.exit(main())
