import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type AuthUser, dataError } from '@workspace/data'

import type { Passwords } from '../../domain/password-confirmation.rule'
import type { SignInError, SignInForm } from '../sign-in.service'

import { createSignInMachine, type SignInEvent } from '.'

/** Ann's form; her password keeps the rules of a new password. */
const ann: SignInForm = {
  email: 'ann@example.test',
  password: 'Secret-ann1',
  name: 'Ann',
  locale: 'en',
}

/** The code the form's error keeps while the password typed again differs. */
const PASSWORDS_DIFFER = 'sign-in:PASSWORDS_DIFFER'

/**
 * The sign-in form over a service whose sign-in is refused because the email is not verified yet
 * and whose sign-up goes through, recording each form it signs up; nothing else is asked here.
 */
function form() {
  const signedUp: SignInForm[] = []
  const actor = createActor(
    createSignInMachine({
      signIn: () =>
        errAsync<AuthUser, SignInError>(
          dataError('data:EMAIL_NOT_VERIFIED', 'the email is not verified yet'),
        ),
      signUp: (signed) => {
        signedUp.push(signed)

        return okAsync(undefined)
      },
      resend: () => okAsync(undefined),
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, signedUp, emitted }
}

/** A switch of mode, with both passwords as typed. */
const toggled = (passwords: Passwords): SignInEvent => ({
  type: 'user.sign-in.toggle-button',
  ...passwords,
})

/** The form switched to sign-up with Ann's password typed and nothing typed again yet. */
function signingUp() {
  const opened = form()

  opened.actor.send(toggled({ password: ann.password, confirmation: '' }))

  return opened
}

/** A keystroke in the password, with both passwords as they are after it. */
const inPassword = (passwords: Passwords): SignInEvent => ({
  type: 'user.sign-in.password-input',
  ...passwords,
})

/** A keystroke in the password typed again, with both passwords as they are after it. */
const inConfirmation = (passwords: Passwords): SignInEvent => ({
  type: 'user.sign-in.password-confirmation-input',
  ...passwords,
})

/** The submit of Ann's form, with the password typed again as `confirmation`. */
const submitted = (confirmation: string): SignInEvent => ({
  type: 'user.sign-in.submit-button',
  form: ann,
  confirmation,
})

describe('the password typed again at sign-up', () => {
  it('lets the form be while it is typed as the password begins, nothing typed yet included', () => {
    const { actor, emitted } = signingUp()

    for (let typed = 0; typed < ann.password.length; typed += 1) {
      actor.send(
        inConfirmation({ password: ann.password, confirmation: ann.password.slice(0, typed) }),
      )

      expect(actor.getSnapshot()).toMatchObject({ value: 'sign-up', context: { error: undefined } })
    }

    expect(emitted).toEqual([])
  })

  it.each([
    ['a character differs', 'Secret-b'],
    ['it is longer', 'Secret-ann1!'],
  ])('says the passwords differ once %s', (_, confirmation) => {
    const { actor, emitted } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
    // The form keeps the code for its own error: the host is asked nothing.
    expect(emitted).toEqual([])
  })

  it('says so when the password is edited under a password typed again', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: ann.password }))
    expect(actor.getSnapshot().value).toBe('sign-up')

    actor.send(inPassword({ password: 'Secret-anx1', confirmation: ann.password }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
  })

  it.each([
    [
      'the password typed again is cut back to how the password begins',
      inConfirmation({ password: ann.password, confirmation: 'Secret' }),
    ],
    [
      'the password typed again is emptied',
      inConfirmation({ password: ann.password, confirmation: '' }),
    ],
    [
      'the password is edited to begin with the password typed again',
      inPassword({ password: 'Secret-b-c1', confirmation: 'Secret-b' }),
    ],
  ])('goes back to sign-up, the error cleared, once %s', (_, follows) => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-b' }))
    expect(actor.getSnapshot().value).toBe('passwords-differ')

    actor.send(follows)

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-up', context: { error: undefined } })
  })

  it('stays where it is while the password typed again goes on straying', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-b' }))
    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-bc' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
  })

  it('asks for no account when only a part of the password was typed again, and takes no submit until the two agree', () => {
    const { actor, signedUp } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-an' }))
    actor.send(submitted('Secret-an'))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
    expect(actor.getSnapshot().can(submitted(ann.password))).toBe(false)

    actor.send(submitted(ann.password))

    expect(actor.getSnapshot().value).toBe('passwords-differ')
    expect(signedUp).toEqual([])
  })

  it('signs up once the two are the same, sending the form without the password typed again', async () => {
    const { actor, signedUp } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-b' }))
    actor.send(inConfirmation({ password: ann.password, confirmation: ann.password }))
    expect(actor.getSnapshot().can(submitted(ann.password))).toBe(true)

    actor.send(submitted(ann.password))

    expect(actor.getSnapshot().value).toBe('signing-up')
    expect((await waitFor(actor, (state) => state.matches('check-mail'))).context.error).toBe(
      undefined,
    )
    expect(signedUp).toStrictEqual([ann])
  })

  it('goes to sign-in on the toggle, the error cleared, and back to the passwords differing on the next', () => {
    const { actor } = signingUp()
    const strayed = { password: ann.password, confirmation: 'Secret-b' }

    actor.send(inConfirmation(strayed))
    actor.send(toggled(strayed))

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })

    actor.send(toggled(strayed))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
  })

  it('compares nothing in the mode sign-in', () => {
    const { actor } = signingUp()

    actor.send(toggled({ password: ann.password, confirmation: '' }))
    actor.send(inPassword({ password: 'Secret-b', confirmation: ann.password }))

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })
  })
})

describe('the rules of a new password at sign-up', () => {
  /**
   * The form in each state the toggle leads into sign-up from, with what it showed there: sign-in
   * as it opens, unverified after a sign-in of an account not verified yet (its error), and
   * check-mail after a sign-up (its mail message).
   */
  const from = {
    'sign-in': () => form(),
    unverified: async () => {
      const opened = form()

      opened.actor.send(submitted(''))
      await waitFor(opened.actor, (state) => state.matches('unverified'))

      return opened
    },
    'check-mail': async () => {
      const opened = signingUp()

      opened.actor.send(submitted(ann.password))
      await waitFor(opened.actor, (state) => state.matches('check-mail'))

      return opened
    },
  } as const

  describe.each(Object.keys(from) as (keyof typeof from)[])('the toggle from %s', (state) => {
    it.each([
      ['nothing typed', { password: '', confirmation: '' }],
      ['a password that breaks a rule', { password: 'secret-ann1', confirmation: 'other' }],
    ])('goes to password-weak with %s, judging no confirmation', async (_, passwords) => {
      const { actor, emitted } = await from[state]()

      expect(actor.getSnapshot().value).toBe(state)

      actor.send(toggled(passwords))

      expect(actor.getSnapshot()).toMatchObject({
        value: 'password-weak',
        context: { error: undefined, mail: undefined },
      })
      expect(emitted).toEqual([])
    })

    it('goes to passwords-differ with a password that keeps the rules and a confirmation that strayed', async () => {
      const { actor } = await from[state]()

      actor.send(toggled({ password: ann.password, confirmation: 'Secret-b' }))

      expect(actor.getSnapshot()).toMatchObject({
        value: 'passwords-differ',
        context: { error: PASSWORDS_DIFFER, mail: undefined },
      })
    })

    it.each([
      ['nothing typed again', ''],
      ['a part typed again', 'Secret'],
      ['the same typed again', ann.password],
    ])('goes to sign-up with a password that keeps the rules and %s', async (_, confirmation) => {
      const { actor } = await from[state]()

      actor.send(toggled({ password: ann.password, confirmation }))

      expect(actor.getSnapshot()).toMatchObject({
        value: 'sign-up',
        context: { error: undefined, mail: undefined },
      })
    })
  })

  it('stays in password-weak while the password goes on breaking a rule, the confirmation not judged', () => {
    const { actor, emitted } = form()

    actor.send(toggled({ password: '', confirmation: '' }))

    for (const password of ['S', 'Se', 'Secret-an', 'Secret ann1']) {
      actor.send(inPassword({ password, confirmation: '' }))

      expect(actor.getSnapshot()).toMatchObject({
        value: 'password-weak',
        context: { error: undefined },
      })
    }

    actor.send(inConfirmation({ password: 'Secret ann1', confirmation: 'x' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'password-weak',
      context: { error: undefined },
    })
    expect(emitted).toEqual([])
  })

  it.each([
    ['nothing typed again', 'sign-up', '', undefined],
    ['the password begun again', 'sign-up', 'Secret', undefined],
    ['the same typed again', 'sign-up', ann.password, undefined],
    ['another typed again', 'passwords-differ', 'Secret-b', PASSWORDS_DIFFER],
  ])(
    'leaves password-weak once the password keeps the rules, with %s, to %s',
    (_, target, confirmation, error) => {
      const { actor } = form()

      actor.send(toggled({ password: '', confirmation }))
      expect(actor.getSnapshot().value).toBe('password-weak')

      actor.send(inPassword({ password: ann.password, confirmation }))

      expect(actor.getSnapshot()).toMatchObject({ value: target, context: { error } })
    },
  )

  it('takes no submit in password-weak, and asks for no account', () => {
    const { actor, signedUp } = form()

    actor.send(toggled({ password: 'secret-ann1', confirmation: 'secret-ann1' }))

    expect(actor.getSnapshot().can(submitted('secret-ann1'))).toBe(false)

    actor.send(submitted('secret-ann1'))

    expect(actor.getSnapshot().value).toBe('password-weak')
    expect(signedUp).toEqual([])
  })

  it('goes from password-weak to sign-in on the toggle, the error cleared', () => {
    const { actor } = form()

    actor.send(toggled({ password: '', confirmation: '' }))
    actor.send(toggled({ password: '', confirmation: '' }))

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })
  })

  it('goes from sign-up to password-weak once the password breaks a rule', () => {
    const { actor } = signingUp()

    actor.send(inPassword({ password: 'Secret-ann', confirmation: '' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'password-weak',
      context: { error: undefined },
    })
  })

  it('goes from passwords-differ to password-weak once the password breaks a rule, the error cleared', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-b' }))
    expect(actor.getSnapshot().value).toBe('passwords-differ')

    actor.send(inPassword({ password: 'Secret-b', confirmation: 'Secret-b' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'password-weak',
      context: { error: undefined },
    })
  })
})

describe('the forgot-link', () => {
  const forgot = (email: string): SignInEvent => ({
    type: 'user.sign-in.forgot-link',
    fields: { 'user.sign-in.email-input': email },
  })

  it('moves to /forgot-password carrying the email typed, from the mode sign-in', () => {
    const { actor, emitted } = form()

    actor.send(forgot('ann@example.test'))

    expect(actor.getSnapshot().value).toBe('forgot-password')
    expect(actor.getSnapshot().status).toBe('done')
    expect(emitted).toEqual([
      {
        type: 'navigate',
        to: '/forgot-password',
        search: { email: { anchor: 'user.sign-in.email-input' } },
        fields: { 'user.sign-in.email-input': 'ann@example.test' },
      },
    ])
  })

  it('moves after a sign-in refused for an email not verified yet, and after a sign-up', async () => {
    const refused = form()

    refused.actor.send(submitted(''))
    await waitFor(refused.actor, (state) => state.matches('unverified'))
    refused.actor.send(forgot('ann@example.test'))

    expect(refused.actor.getSnapshot().value).toBe('forgot-password')

    const signedUp = signingUp()

    signedUp.actor.send(submitted(ann.password))
    await waitFor(signedUp.actor, (state) => state.matches('check-mail'))
    signedUp.actor.send(forgot('ann@example.test'))

    expect(signedUp.actor.getSnapshot().value).toBe('forgot-password')
  })

  it('is not taken in the mode sign-up', () => {
    const { actor } = signingUp()

    expect(actor.getSnapshot().can(forgot(''))).toBe(false)
  })
})
