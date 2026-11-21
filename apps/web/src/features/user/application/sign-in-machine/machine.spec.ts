import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type AuthUser, type CodeStep, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { Passwords } from '../../domain/password-confirmation.rule'
import type { SignInError, SignInForm, SignInOutcome, SignInService } from '../sign-in.service'

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

/** The service's second steps for a form whose tests ask for none of them. */
const noSecondSteps: Pick<SignInService, 'confirmSignIn' | 'signInWithPasskey'> = {
  confirmSignIn: () => errAsync(dataError('data:AUTH_FAILED', 'no code step in this test')),
  signInWithPasskey: () => errAsync(dataError('data:AUTH_FAILED', 'no passkey in this test')),
}

/**
 * The sign-in form over a service whose sign-in is refused because the email is not verified yet
 * and whose sign-up goes through, recording each form it signs up; nothing else is asked here.
 */
function form() {
  const signedUp: SignInForm[] = []
  const actor = createActor(
    createSignInMachine({
      signIn: () =>
        errAsync<SignInOutcome, SignInError>(
          dataError('data:EMAIL_NOT_VERIFIED', 'the email is not verified yet'),
        ),
      signUp: (signed) => {
        signedUp.push(signed)

        return okAsync(undefined)
      },
      resend: () => okAsync(undefined),
      ...noSecondSteps,
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

/** Ann, as a sign-in that goes through answers. */
const annUser: AuthUser = { id: identityIdFactory.create(), email: ann.email }

/** A sign-in that finds the account on as many devices as it may be, signing nothing in. */
const atTheLimit = () => okAsync<SignInOutcome, SignInError>({ kind: 'device-limit' })

/** A sign-in that signs Ann in. */
const signedIn = () => okAsync<SignInOutcome, SignInError>({ kind: 'signed-in', user: annUser })

/**
 * The sign-in form over a service whose sign-ins answer `answers` in turn, recording whether each
 * one confirmed signing out the device seen least recently; nothing else is asked here.
 */
function limited(answers: ReadonlyArray<() => ResultAsync<SignInOutcome, SignInError>>) {
  const confirmed: boolean[] = []
  const actor = createActor(
    createSignInMachine({
      signIn: (_form, signOutOldest) => {
        const answer = answers[confirmed.length] ?? expect.unreachable('no sign-in beyond these')

        confirmed.push(signOutOldest)

        return answer()
      },
      signUp: () => okAsync(undefined),
      resend: () => okAsync(undefined),
      ...noSecondSteps,
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, confirmed, emitted }
}

/** The dialog's confirmation, with Ann's form as typed. */
const confirmedAnyway: SignInEvent = {
  type: 'user.sign-in.device-limit-dialog.confirm-button',
  form: ann,
}

/** What the form asks its host to show once a sign-in finds the account at its limit. */
const ASKED = { type: 'show', anchor: 'user.sign-in.device-limit-dialog', codes: ['device-limit'] }

describe('a sign-in past the limit of devices', () => {
  it('asks in its dialog, then signs in all the same once confirmed, signing out the device seen least recently', async () => {
    const { actor, confirmed, emitted } = limited([atTheLimit, signedIn])

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('device-limit'))

    expect(confirmed).toEqual([false])
    expect(emitted).toEqual([ASKED])

    actor.send(confirmedAnyway)
    await waitFor(actor, (state) => state.matches('done'))

    expect(confirmed).toEqual([false, true])
    expect(emitted).toEqual([
      ASKED,
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: '/me' },
    ])
  })

  it('goes back to the form on cancel, asking nothing more', async () => {
    const { actor, confirmed } = limited([atTheLimit])

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('device-limit'))
    actor.send({ type: 'user.sign-in.device-limit-dialog.cancel-button' })

    expect(actor.getSnapshot().value).toBe('sign-in')
    expect(confirmed).toEqual([false])
  })

  it.each([
    ['data:EMAIL_NOT_VERIFIED', 'unverified'],
    ['data:INVALID_CREDENTIALS', 'sign-in'],
    ['data:ACCOUNT_BANNED', 'sign-in'],
  ] as const)(
    'shows %s, refusing the confirmed sign-in, as a refused sign-in does',
    async (code, state) => {
      const { actor } = limited([
        atTheLimit,
        () => errAsync<SignInOutcome, SignInError>(dataError(code, 'the sign-in was refused')),
      ])

      actor.send(submitted(''))
      await waitFor(actor, (snapshot) => snapshot.matches('device-limit'))
      actor.send(confirmedAnyway)

      const refused = await waitFor(actor, (snapshot) => snapshot.context.error !== undefined)

      expect(refused.value).toBe(state)
      expect(refused.context.error).toBe(code)
    },
  )
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

/** What the code step of a sign-in carries from the password step. */
const step: CodeStep = { challenge: 'challenge-1', email: ann.email }

/** The password step of an account whose second factor is on: a code is asked, nothing signed in. */
const asksCode = () => okAsync<SignInOutcome, SignInError>({ kind: 'code-required', ...step })

/** The code step's refusals and answers, as the session fails or answers them. */
const refusedWith = (code: Parameters<typeof dataError>[0]) => () =>
  errAsync<SignInOutcome, SignInError>(dataError(code, 'the step was refused'))

/** The dialog's confirmation with `code` typed in its input. */
const codeTyped = (code: string): SignInEvent => ({
  type: 'user.sign-in.code.dialog.confirm-button',
  code,
})

/** What the screen asks its host when the code step starts, and when it ends in the welcome. */
const ASKED_CODE = {
  type: 'show',
  anchor: 'user.sign-in.code.dialog',
  codes: ['code-required'],
}
const CLEARED_CODE = { type: 'clear', anchor: 'user.sign-in.code.code-input' }
const WELCOMED = [
  { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
  { type: 'navigate', to: '/me' },
]

/** One answer of a queue for each call, in turn. */
type Answers = ReadonlyArray<() => ResultAsync<SignInOutcome, SignInError>>

/**
 * The sign-in form over a service whose three steps answer from queues, one answer for each call
 * in turn, recording what each was asked: the password step (with whether it signed out the
 * device seen least recently), the code step, and the passkey's.
 */
function stepping(answers: { signIn?: Answers; confirm?: Answers; passkey?: Answers }) {
  const asked = {
    signIn: [] as boolean[],
    confirm: [] as Array<{ step: CodeStep; code: string; signOutOldest: boolean }>,
    passkey: [] as Array<string | undefined>,
  }
  const next = (queue: Answers | undefined, taken: number) =>
    (queue?.[taken] ?? expect.unreachable('no answer for this call'))()
  const actor = createActor(
    createSignInMachine({
      signIn: (_form, signOutOldest) => {
        asked.signIn.push(signOutOldest)

        return next(answers.signIn, asked.signIn.length - 1)
      },
      signUp: () => okAsync(undefined),
      resend: () => okAsync(undefined),
      confirmSignIn: (held, code, signOutOldest) => {
        asked.confirm.push({ step: held, code, signOutOldest })

        return next(answers.confirm, asked.confirm.length - 1)
      },
      signInWithPasskey: (signOutOldestFor) => {
        asked.passkey.push(signOutOldestFor)

        return next(answers.passkey, asked.passkey.length - 1)
      },
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, asked, emitted }
}

describe('a sign-in whose account asks for a code', () => {
  it('asks in its dialog, holding the challenge and the email, and signs nothing in', async () => {
    const { actor, asked, emitted } = stepping({ signIn: [asksCode] })

    actor.send(submitted(''))

    const asking = await waitFor(actor, (state) => state.matches('code'))

    expect(asking.context.step).toEqual(step)
    expect(asking.context.error).toBeUndefined()
    expect(asked.signIn).toEqual([false])
    expect(asked.confirm).toEqual([])
    expect(emitted).toEqual([ASKED_CODE])
  })

  it('signs in with the code typed, clearing the field, then says the welcome and moves to the profile', async () => {
    const { actor, asked, emitted } = stepping({ signIn: [asksCode], confirm: [signedIn] })

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send(codeTyped('123456'))
    await waitFor(actor, (state) => state.matches('done'))

    expect(asked.confirm).toEqual([{ step, code: '123456', signOutOldest: false }])
    expect(emitted).toEqual([ASKED_CODE, CLEARED_CODE, ...WELCOMED])
    expect(actor.getSnapshot().context.step).toBeUndefined()
  })

  it('stays in the dialog under the field after a wrong code, and asks again with the same challenge', async () => {
    const { actor, asked, emitted } = stepping({
      signIn: [asksCode],
      confirm: [refusedWith('data:INVALID_CODE'), signedIn],
    })

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send(codeTyped('000000'))

    const refused = await waitFor(actor, (state) => state.context.codeError !== undefined)

    expect(refused.value).toBe('code')
    expect(refused.context).toMatchObject({
      codeError: 'data:INVALID_CODE',
      error: undefined,
      step,
    })
    // The form shows nothing and the field keeps what was typed: the host is asked no clear.
    expect(emitted).toEqual([ASKED_CODE])

    actor.send(codeTyped('123456'))
    await waitFor(actor, (state) => state.matches('done'))

    expect(asked.confirm.map((each) => each.step)).toEqual([step, step])
    expect(actor.getSnapshot().context.codeError).toBeUndefined()
  })

  it('shows any other failure of the code in the dialog, not on the form', async () => {
    const { actor } = stepping({
      signIn: [asksCode],
      confirm: [refusedWith('data:AUTH_FAILED')],
    })

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send(codeTyped('123456'))

    const refused = await waitFor(actor, (state) => state.context.codeError !== undefined)

    expect(refused.value).toBe('code')
    expect(refused.context).toMatchObject({ codeError: 'data:AUTH_FAILED', error: undefined })
  })

  it.each([
    'data:CODE_EXPIRED',
    'data:ACCOUNT_BANNED',
    'data:RATE_LIMITED',
    'data:OTHER_ACCOUNT',
  ] as const)(
    'goes back to the password with %s on the form, the field cleared and the challenge dropped',
    async (code) => {
      const { actor, emitted } = stepping({ signIn: [asksCode], confirm: [refusedWith(code)] })

      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('code'))
      actor.send(codeTyped('123456'))

      const ended = await waitFor(actor, (state) => state.context.error !== undefined)

      expect(ended.value).toBe('sign-in')
      expect(ended.context).toMatchObject({ error: code, codeError: undefined, step: undefined })
      expect(emitted).toEqual([ASKED_CODE, CLEARED_CODE])
    },
  )

  it('starts again from the password on cancel, the field and the error cleared', async () => {
    const { actor, emitted } = stepping({
      signIn: [asksCode],
      confirm: [refusedWith('data:INVALID_CODE')],
    })

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send(codeTyped('000000'))
    await waitFor(actor, (state) => state.context.codeError !== undefined)
    actor.send({ type: 'user.sign-in.code.dialog.cancel-button' })

    const back = actor.getSnapshot()

    expect(back.value).toBe('sign-in')
    expect(back.context).toMatchObject({ codeError: undefined, error: undefined, step: undefined })
    expect(emitted).toEqual([ASKED_CODE, CLEARED_CODE])
  })

  it('takes a code only in the dialog, and not while one is being confirmed', async () => {
    const { actor } = stepping({ signIn: [asksCode], confirm: [signedIn] })

    expect(actor.getSnapshot().can(codeTyped('123456'))).toBe(false)

    actor.send(submitted(''))
    await waitFor(actor, (state) => state.matches('code'))

    expect(actor.getSnapshot().can(codeTyped('123456'))).toBe(true)

    actor.send(codeTyped('123456'))

    expect(actor.getSnapshot().value).toBe('confirming-code')
    expect(actor.getSnapshot().can(codeTyped('123456'))).toBe(false)
    expect(actor.getSnapshot().can({ type: 'user.sign-in.code.dialog.cancel-button' })).toBe(false)
  })

  describe('at the limit of devices', () => {
    it('asks about the limit once the code is right, signing nothing in, then signs in again from the password and asks the code again', async () => {
      const { actor, asked, emitted } = stepping({
        signIn: [asksCode, asksCode],
        confirm: [atTheLimit, signedIn],
      })

      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('code'))
      actor.send(codeTyped('123456'))
      await waitFor(actor, (state) => state.matches('device-limit'))

      expect(emitted).toEqual([ASKED_CODE, CLEARED_CODE, ASKED])
      expect(actor.getSnapshot().context.step).toBeUndefined()

      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('code-anyway'))

      expect(asked.signIn).toEqual([false, true])
      expect(actor.getSnapshot().context.step).toEqual(step)

      actor.send(codeTyped('123456'))
      await waitFor(actor, (state) => state.matches('done'))

      expect(asked.confirm).toEqual([
        { step, code: '123456', signOutOldest: false },
        { step, code: '123456', signOutOldest: true },
      ])
      expect(emitted).toEqual([
        ASKED_CODE,
        CLEARED_CODE,
        ASKED,
        ASKED_CODE,
        CLEARED_CODE,
        ...WELCOMED,
      ])
    })

    it('asks the code in the dialog of the confirmed sign-in, and shows a wrong code there', async () => {
      const { actor } = stepping({
        signIn: [atTheLimit, asksCode],
        confirm: [refusedWith('data:INVALID_CODE'), signedIn],
      })

      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('device-limit'))
      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('code-anyway'))
      actor.send(codeTyped('000000'))

      const refused = await waitFor(actor, (state) => state.context.codeError !== undefined)

      expect(refused.value).toBe('code-anyway')
      expect(refused.context.codeError).toBe('data:INVALID_CODE')

      actor.send(codeTyped('123456'))
      await waitFor(actor, (state) => state.matches('done'))
    })

    it.each([
      'data:CODE_EXPIRED',
      'data:ACCOUNT_BANNED',
      'data:RATE_LIMITED',
      'data:OTHER_ACCOUNT',
    ] as const)('goes back to the password with %s on the form', async (code) => {
      const { actor, emitted } = stepping({
        signIn: [atTheLimit, asksCode],
        confirm: [refusedWith(code)],
      })

      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('device-limit'))
      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('code-anyway'))
      actor.send(codeTyped('123456'))

      const ended = await waitFor(actor, (state) => state.context.error !== undefined)

      expect(ended.value).toBe('sign-in')
      expect(ended.context).toMatchObject({ error: code, codeError: undefined, step: undefined })
      expect(emitted).toContainEqual(CLEARED_CODE)
    })

    it('starts again from the password on cancel', async () => {
      const { actor } = stepping({ signIn: [atTheLimit, asksCode] })

      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('device-limit'))
      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('code-anyway'))
      actor.send({ type: 'user.sign-in.code.dialog.cancel-button' })

      expect(actor.getSnapshot().value).toBe('sign-in')
      expect(actor.getSnapshot().context.step).toBeUndefined()
    })
  })
})

/** The passkey sign-in of an account at its limit of devices names the account it asks about. */
const limitedFor = (account: string) => () =>
  okAsync<SignInOutcome, SignInError>({ kind: 'device-limit', consentFor: account })

describe('a sign-in with a passkey', () => {
  /** The form in each state that offers the passkey button, as a sign-in or a sign-up leaves it. */
  const offering = {
    'sign-in': async (actor: ReturnType<typeof stepping>['actor']) => actor,
    unverified: async (actor: ReturnType<typeof stepping>['actor']) => {
      actor.send(submitted(''))
      await waitFor(actor, (state) => state.matches('unverified'))

      return actor
    },
    'check-mail': async (actor: ReturnType<typeof stepping>['actor']) => {
      actor.send(toggled({ password: ann.password, confirmation: ann.password }))
      actor.send(submitted(ann.password))
      await waitFor(actor, (state) => state.matches('check-mail'))

      return actor
    },
  }
  const passkeyButton: SignInEvent = { type: 'user.sign-in.passkey-button' }

  it.each(Object.keys(offering) as Array<keyof typeof offering>)(
    'asks for one from %s, then says the welcome and moves to the profile',
    async (from) => {
      const { actor, asked, emitted } = stepping({
        signIn: [refusedWith('data:EMAIL_NOT_VERIFIED')],
        passkey: [signedIn],
      })

      await offering[from](actor)
      emitted.length = 0
      actor.send(passkeyButton)

      expect(actor.getSnapshot().value).toBe('signing-in-passkey')

      await waitFor(actor, (state) => state.matches('done'))

      expect(asked.passkey).toEqual([undefined])
      expect(emitted).toEqual(WELCOMED)
    },
  )

  it('takes the mail message away when it comes from the message asking to check the mail', async () => {
    const { actor } = stepping({ passkey: [signedIn] })

    await offering['check-mail'](actor)

    expect(actor.getSnapshot().context.mail).toBe('check-your-mail')

    actor.send(passkeyButton)

    expect(actor.getSnapshot().context).toMatchObject({ mail: undefined, sentTo: undefined })
  })

  it.each(['sign-up', 'password-weak', 'passwords-differ'] as const)(
    'is not offered in the mode sign-up, in %s',
    (state) => {
      const { actor } = stepping({})

      actor.send(toggled({ password: ann.password, confirmation: '' }))
      if (state === 'password-weak') {
        actor.send(inPassword({ password: 'weak', confirmation: '' }))
      } else if (state === 'passwords-differ') {
        actor.send(inConfirmation({ password: ann.password, confirmation: 'Secret-b' }))
      }

      expect(actor.getSnapshot().value).toBe(state)
      expect(actor.getSnapshot().can(passkeyButton)).toBe(false)
    },
  )

  it.each([
    'data:PASSKEY_CANCELLED',
    'data:PASSKEY_UNKNOWN',
    'data:OTHER_ACCOUNT',
    'data:ACCOUNT_BANNED',
    'data:AUTH_FAILED',
  ] as const)('goes back to the form with %s on it, signing nothing in', async (code) => {
    const { actor, emitted } = stepping({ passkey: [refusedWith(code)] })

    actor.send(passkeyButton)

    const refused = await waitFor(actor, (state) => state.context.error !== undefined)

    expect(refused.value).toBe('sign-in')
    expect(refused.context.error).toBe(code)
    expect(emitted).toEqual([])
  })

  it('clears the form error as the next attempt starts, and takes no second press while it runs', async () => {
    const { actor, asked } = stepping({
      passkey: [refusedWith('data:PASSKEY_CANCELLED'), signedIn],
    })

    actor.send(passkeyButton)
    await waitFor(actor, (state) => state.context.error !== undefined)
    actor.send(passkeyButton)

    expect(actor.getSnapshot().context.error).toBeUndefined()
    expect(actor.getSnapshot().can(passkeyButton)).toBe(false)

    actor.send(passkeyButton)
    await waitFor(actor, (state) => state.matches('done'))

    expect(asked.passkey).toEqual([undefined, undefined])
  })

  describe('at the limit of devices', () => {
    it('asks in the dialog, naming the account, and signs in again naming it once confirmed', async () => {
      const { actor, asked, emitted } = stepping({
        passkey: [limitedFor('idn_ann'), signedIn],
      })

      actor.send(passkeyButton)
      await waitFor(actor, (state) => state.matches('passkey-device-limit'))

      expect(actor.getSnapshot().context.consentFor).toBe('idn_ann')
      expect(emitted).toEqual([ASKED])

      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('done'))

      expect(asked.passkey).toEqual([undefined, 'idn_ann'])
      expect(emitted).toEqual([ASKED, ...WELCOMED])
      expect(actor.getSnapshot().context.consentFor).toBeUndefined()
    })

    it('asks afresh when the passkey picked on the confirmation is another account at its limit', async () => {
      const { actor, asked, emitted } = stepping({
        passkey: [limitedFor('idn_ann'), limitedFor('idn_bob'), signedIn],
      })

      actor.send(passkeyButton)
      await waitFor(actor, (state) => state.matches('passkey-device-limit'))
      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.context.consentFor === 'idn_bob')

      expect(actor.getSnapshot().value).toBe('passkey-device-limit')
      expect(emitted).toEqual([ASKED, ASKED])

      actor.send(confirmedAnyway)
      await waitFor(actor, (state) => state.matches('done'))

      expect(asked.passkey).toEqual([undefined, 'idn_ann', 'idn_bob'])
    })

    it('signs nothing in on cancel, and forgets the account it asked about', async () => {
      const { actor, asked } = stepping({ passkey: [limitedFor('idn_ann')] })

      actor.send(passkeyButton)
      await waitFor(actor, (state) => state.matches('passkey-device-limit'))
      actor.send({ type: 'user.sign-in.device-limit-dialog.cancel-button' })

      expect(actor.getSnapshot().value).toBe('sign-in')
      expect(actor.getSnapshot().context.consentFor).toBeUndefined()
      expect(asked.passkey).toEqual([undefined])
    })

    it('holds the passkey button while the dialog asks', async () => {
      const { actor, asked } = stepping({
        passkey: [limitedFor('idn_ann'), signedIn],
      })

      actor.send(passkeyButton)
      await waitFor(actor, (state) => state.matches('passkey-device-limit'))

      expect(actor.getSnapshot().can(passkeyButton)).toBe(false)
      expect(asked.passkey).toEqual([undefined])
    })

    it.each([
      ['data:PASSKEY_CANCELLED', 'sign-in'],
      ['data:ACCOUNT_BANNED', 'sign-in'],
    ] as const)('shows %s, refusing the confirmed sign-in, on the form', async (code, state) => {
      const { actor } = stepping({
        passkey: [limitedFor('idn_ann'), refusedWith(code)],
      })

      actor.send(passkeyButton)
      await waitFor(actor, (snapshot) => snapshot.matches('passkey-device-limit'))
      actor.send(confirmedAnyway)

      const refused = await waitFor(actor, (snapshot) => snapshot.context.error !== undefined)

      expect(refused.value).toBe(state)
      expect(refused.context.error).toBe(code)
    })
  })
})
