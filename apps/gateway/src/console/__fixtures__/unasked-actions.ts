/**
 * The services of the console's changes, mails and removal for a spec that never asks for them
 * (the reads, the bans): the routes are built whole, and each service fails the test if it is
 * asked after all.
 */

import { expect } from 'vitest'

import type { ConsoleRoutesOptions } from '../console-routes'

/** Fails the test: a service of an action the spec does not ask for was asked. */
const unasked = (what: string) => (): never =>
  expect.unreachable(`the spec asks for no ${what}, yet it was asked`)

export const unaskedActions: Pick<
  ConsoleRoutesOptions,
  'names' | 'emailChanges' | 'passwords' | 'auth' | 'mails' | 'limits' | 'departure' | 'teardown'
> = {
  names: { rename: unasked('rename') },
  emailChanges: { ask: unasked('change of an email'), cancel: unasked('change of an email') },
  passwords: { requestReset: unasked('reset mail') },
  auth: { handler: unasked('verification mail') },
  mails: { confirmEmail: unasked('confirmation mail'), accountDeleted: unasked('removal notice') },
  limits: {
    emailChangeMail: unasked('change of an email'),
    resetMail: unasked('reset mail'),
    verificationMail: unasked('verification mail'),
  },
  departure: { leave: unasked('removal') },
  teardown: { addressee: unasked('removal'), remove: unasked('removal') },
}
