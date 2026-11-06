/**
 * The take check's parts: the commit message read as git records it, and what the check says of a
 * commit on an area branch (`scripts/contract-take.ts`).
 */

export { type Message, readMessage, type Trailer } from './message.ts'
export { takeRefusal } from './refusal.ts'
