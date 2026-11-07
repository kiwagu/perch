/**
 * The take check's parts: the commit message read as git records it, what the check says of a
 * commit on an area branch, and of the round a branch lands on `main`, judged as git recorded it
 * (`scripts/contract-take.ts`).
 */

export { type Cleanup, type CommitCommand, commitCommand } from './command.ts'
export { FORM, NEVER_LANDS, SQUASH_FORM, SQUASHED, UNJUDGED_BRANCHES } from './form.ts'
export { roundRefusal } from './landing.ts'
export {
  type Doubt,
  type Message,
  type Reading,
  readingOf,
  readMessage,
  type Trailer,
} from './message.ts'
export { recordedFiles, recordedMessage } from './recorded.ts'
export { takeRefusal } from './refusal.ts'
export { type Landed, type Lookup, lookupOf, parseSquashed, type Round, roundOf } from './round.ts'
export { landingRefusal } from './squash.ts'
