/**
 * The application's reads and writes, bound to the space of whoever is signed in: the
 * container hands out these two ports once, and they follow the session from one identity
 * to the next. While nobody is signed in they refuse, saying so; while the saved identity's
 * space opens at the start they wait for it; writes also refuse while a sign-out runs in any tab
 * of the browser. Each port is a class in a file of its own.
 */

export { CurrentSpaceRunner } from './current-space-runner'
export { CurrentSpaceWritePath } from './current-space-write-path'
export type { SpaceSource } from './space-source'
