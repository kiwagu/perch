/**
 * What the take check says of a commit on `main`, judged as a landing: nothing when it is the
 * squash of the tip its `Squashed-from` trailer names, on top of `main`, and every commit of that
 * tip's round is in a take's form; otherwise one line saying what `main` takes, ending with the
 * form of a landing, or the round's refusal (`landing.ts`).
 */

import { indexTreeId } from '../gates/tree.ts'
import { git, merging } from '../staged-commit.ts'

import { NEVER_LANDS, SQUASH_FORM, SQUASHED, TRUNK, UNJUDGED_BRANCHES } from './form.ts'
import { roundRefusal, shortOf } from './landing.ts'
import type { Message } from './message.ts'
import { doubtLine } from './refusal.ts'
import { type Landed, lookupOf, parseSquashed } from './round.ts'

const PREFIX = 'contract take: '

/** The form of a landing's trailer, as a refusal names it. */
const TRAILER_FORM = `${SQUASHED}: <branch> (<tip>) <card>`

/** What a landing's trailer names, with the tip and the commit's parent resolved to their full ids. */
interface Binding {
  readonly branch: string
  readonly tip: string
  readonly parent: string
}

/** The full id of the commit `rev` names, or undefined when git knows none. */
function commitOf(rev: string): string | undefined {
  const { status, out } = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])

  return status === 0 ? out.trim() : undefined
}

/**
 * The id `refs/heads/<branch>` holds, read from that ref exactly, never from a revision of it
 * (`feat/me~0`), or undefined when git has no such branch.
 */
function branchTip(branch: string): string | undefined {
  const { status, out } = git(['show-ref', '--verify', '--hash', `refs/heads/${branch}`])
  const id = out.trim()

  return status === 0 && id !== '' ? id : undefined
}

/** The id of the tree `rev` records, or undefined when git knows none. */
function treeOf(rev: string): string | undefined {
  const { status, out } = git(['rev-parse', '--verify', '--quiet', `${rev}^{tree}`])

  return status === 0 ? out.trim() : undefined
}

/** The tree this commit records, read from the index git is committing, or undefined when git cannot write it. */
function stagedTree(): string | undefined {
  try {
    return indexTreeId()
  } catch {
    return undefined
  }
}

/** Whether `commit` is `other` or one of its ancestors, or undefined when git cannot tell. */
function under(commit: string, other: string): boolean | undefined {
  const { status } = git(['merge-base', '--is-ancestor', commit, other])

  return status === 0 ? true : status === 1 ? false : undefined
}

/**
 * What `git cat-file --batch-check` says of `tip` looked up among commits, as written (a short id
 * shared by two commits is ambiguous; asked for as `<tip>^{commit}` it would be missing), or
 * undefined when git fails.
 */
function lookedUp(tip: string): string | undefined {
  const { status, out } = git(
    ['-c', 'core.disambiguate=commit', 'cat-file', '--batch-check'],
    `${tip}\n`,
  )
  const [line] = out.split('\n')

  return status === 0 && line !== undefined && line !== '' ? line : undefined
}

/** The refusal of a commit on `main` that is no squash in its form: `problem`, then what main takes. */
function squashRefusal(problem: string): string {
  return `${PREFIX}${problem}\nA landing on main is ${SQUASH_FORM}`
}

/** What the one `Squashed-from` trailer of `message` names, or what is wrong with its trailers. */
function squashedOf(message: Message): Landed | string {
  const squashes = message.trailers.filter(
    ({ key }) => key.toLowerCase() === SQUASHED.toLowerCase(),
  )
  const [trailer] = squashes

  if (trailer === undefined) {
    return `main takes squashes only, and this commit names the branch it squashes in no trailer: "${TRAILER_FORM}", as the message's last paragraph, after an empty line.`
  }

  if (squashes.length > 1) {
    return `a landing names the branch it squashes in one trailer, and this commit has ${squashes.length}.`
  }

  if (trailer.key !== SQUASHED) {
    return `its trailer's key is written "${SQUASHED}:", in that case, not "${trailer.key}:".`
  }

  return (
    parseSquashed(trailer.value) ??
    `its trailer reads "${TRAILER_FORM}", the tip as 7 to 40 hex digits in parentheses, then the cards: "${SQUASHED}: ${trailer.value}" is not.`
  )
}

/**
 * What binds the commit to the tip its trailer names, on `main`'s HEAD or on HEAD's first parent
 * when `amend`: the branch has the tip, the parent is under it, and the commit records the tip's
 * tree, a change of `main`; or what is wrong.
 */
function bindingOf({ branch, tip }: Landed, amend: boolean): Binding | string {
  const parent = commitOf(amend ? 'HEAD~1' : 'HEAD')

  if (parent === undefined) {
    return `main has no commit ${amend ? 'under the one this commit replaces' : 'yet'} to land on: a landing changes main.`
  }

  const head = branchTip(branch)

  if (head === undefined) {
    return `this commit's trailer names ${branch}, and git knows no branch ${branch} in this clone.`
  }

  if (NEVER_LANDS(branch)) {
    return `${branch} never lands on main: ${branch === TRUNK ? 'an area branch takes the business layer from the trunk' : 'an experiment is split into area branches first'}, and a landing squashes an area branch.`
  }

  const line = lookedUp(tip)

  if (line === undefined) {
    return `git cannot look up ${tip}, the tip this commit's trailer names.`
  }

  const lookup = lookupOf(line)

  if (lookup === 'ambiguous') {
    return `this commit's trailer names ${tip}, which git cannot tell from another commit: name the tip by more of its id.`
  }

  if (lookup === 'missing') {
    return `git knows no commit ${tip}, which this commit's trailer names as the tip of ${branch}, in this clone.`
  }

  const id = line.slice(0, line.indexOf(' '))
  const onBranch = under(id, head)

  if (onBranch === undefined) {
    return `git cannot tell whether ${tip} is on ${branch}.`
  }

  if (!onBranch) {
    return `${tip} is not on ${branch}, which this commit's trailer names as its branch: a landing names the branch's tip.`
  }

  const onTop = under(parent, id)

  if (onTop === undefined) {
    return `git cannot tell whether main is under ${tip}.`
  }

  if (!onTop) {
    return `main (${shortOf(parent)}) is not under ${tip}: bring main into ${branch} and squash it again, so that the landing sits on top of main.`
  }

  const [staged, tipTree, parentTree] = [stagedTree(), treeOf(id), treeOf(parent)]

  if (staged === undefined || tipTree === undefined || parentTree === undefined) {
    return `git cannot read the tree this commit records, or the trees of ${tip} and of main.`
  }

  if (staged !== tipTree) {
    return `this commit's tree is not the tree of ${tip}, the tip its trailer names: a landing commits the squash of that tip, nothing more and nothing less.`
  }

  if (staged === parentTree) {
    return `a landing changes main, and this commit's tree is main's: there is nothing to land.`
  }

  return { branch, tip: id, parent }
}

/**
 * The refusal of a commit on `main`, judged as the landing its `Squashed-from` trailer names,
 * the commit replacing HEAD when `amend`: the line saying what main takes when the commit is no
 * squash of the named tip on top of main, or the round's refusal; undefined when the landing
 * passes.
 */
export function landingRefusal(message: Message, amend: boolean): string | undefined {
  if (merging()) {
    return squashRefusal('main takes squashes only, and this commit is a merge.')
  }

  if (message.doubt !== undefined) {
    return squashRefusal(`on main, ${doubtLine(message.doubt)}`)
  }

  const landed = squashedOf(message)

  if (typeof landed === 'string') {
    return squashRefusal(landed)
  }

  const bound = bindingOf(landed, amend)

  if (typeof bound === 'string') {
    return squashRefusal(bound)
  }

  if (UNJUDGED_BRANCHES.includes(bound.branch)) {
    return undefined
  }

  return roundRefusal(bound.branch, bound.tip, bound.parent)
}
