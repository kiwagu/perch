// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/user.en.json'
import es from '../../i18n/user.es.json'

import { SignInView, type SignInViewProps } from './sign-in.view'

function renderView(props: Partial<SignInViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onSubmit: vi.fn(() => Promise.resolve(true)),
    onToggleMode: vi.fn(),
    onTypePassword: vi.fn(),
    onResend: vi.fn((_email: string) => Promise.resolve(true)),
    onForgot: vi.fn((_email: string) => {}),
  }

  renderWithProviders(
    <SignInView
      startEmail=""
      mode="sign-in"
      showResend={false}
      can={() => true}
      {...handlers}
      {...props}
    />,
    { locale, es },
  )

  return handlers
}

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

/** The code the form's error keeps while the password typed again differs. */
const PASSWORDS_DIFFER = 'sign-in:PASSWORDS_DIFFER'

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

const LENGTH = 'user.sign-in.password-rule-list.length-item'
const CHARACTERS = 'user.sign-in.password-rule-list.characters-item'
const DIGIT = 'user.sign-in.password-rule-list.digit-item'
const UPPERCASE = 'user.sign-in.password-rule-list.uppercase-item'
const LOWERCASE = 'user.sign-in.password-rule-list.lowercase-item'
const SYMBOL = 'user.sign-in.password-rule-list.symbol-item'

/** The items of the list of rules, in the order it shows them. */
const RULE_ITEMS = [LENGTH, CHARACTERS, DIGIT, UPPERCASE, LOWERCASE, SYMBOL]

/** The items of the list of rules marked `met`, in order; every other item carries no state. */
function markedMet(): string[] {
  const items = RULE_ITEMS.map((testId) => screen.getByTestId(testId))

  expect(items.map((item) => item.getAttribute('data-state'))).toEqual(
    items.map((item) => (item.getAttribute('data-state') === 'met' ? 'met' : null)),
  )

  return RULE_ITEMS.filter((testId) => screen.getByTestId(testId).getAttribute('data-state'))
}

/** The text tones a rule item can take: muted, the success tone, or red. */
const TONES = ['text-muted-foreground', 'text-success', 'text-destructive']

/**
 * The tones that apply to a rule item in the state it carries, the one that shows last: its plain
 * classes, then its variants of that state. Tailwind's `data-[state=…]:` rule also selects the
 * attribute and comes after the plain utilities, so it wins while it applies.
 */
function tonesOf(testId: string): string[] {
  const item = screen.getByTestId(testId)
  const state = item.getAttribute('data-state')
  const classes = [...item.classList]
  const variant = state ? `data-[state=${state}]:` : undefined
  const applied = [
    ...classes.filter((name) => !name.startsWith('data-[')),
    ...classes.flatMap((name) =>
      variant && name.startsWith(variant) ? [name.slice(variant.length)] : [],
    ),
  ]

  return applied.filter((name) => TONES.includes(name))
}

/** The notice of the last session, once it carries `code`. */
function noticeWith(code: string): HTMLElement {
  const notice = screen.getByTestId('user.sign-in.notice-message')

  expect(notice.getAttribute('data-code')).toBe(code)

  return notice
}

describe('SignInView', () => {
  it('asks for email and password to sign in, and offers to create an account', () => {
    const { onSubmit, onToggleMode } = renderView()

    expect(screen.getByTestId('user.sign-in.form').tagName).toBe('FORM')
    expect(screen.queryByTestId('user.sign-in.password-confirmation-input')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.name-input')).toBeNull()
    expect(input('user.sign-in.password-input').autocomplete).toBe('current-password')
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-up',
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').textContent).toBe(
      en['user.sign-in.create-account'],
    )

    type('user.sign-in.email-input', 'ann@example.test')
    type('user.sign-in.password-input', 'secret-ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      en['user.sign-in.sign-in'],
    )
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'secret-ann',
      confirmation: '',
      name: '',
    })

    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))

    // The switch carries the passwords as typed, for the flow to judge on the way into sign-up.
    expect(onToggleMode).toHaveBeenCalledExactlyOnceWith({
      password: 'secret-ann',
      confirmation: '',
    })
  })

  it('starts with the email a page carried over, and signs in with the email as typed', () => {
    const { onSubmit } = renderView({ startEmail: 'ann@example.test' })

    expect(input('user.sign-in.email-input').value).toBe('ann@example.test')

    type('user.sign-in.password-input', 'secret-ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'secret-ann',
      confirmation: '',
      name: '',
    })
  })

  it('also asks for the password again and a name to create an account', () => {
    const { onSubmit } = renderView({ mode: 'sign-up' })

    type('user.sign-in.email-input', 'ann@example.test')
    type('user.sign-in.password-input', 'Secret-ann1')
    type('user.sign-in.password-confirmation-input', 'Secret-ann1')
    type('user.sign-in.name-input', 'Ann')
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      en['user.sign-in.sign-up'],
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-in',
    )
    expect(screen.getByTestId('user.sign-in.toggle-button').textContent).toBe(
      en['user.sign-in.have-account'],
    )
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ann@example.test',
      password: 'Secret-ann1',
      confirmation: 'Secret-ann1',
      name: 'Ann',
    })
  })

  it('asks for the password again to create an account, both as a new password', () => {
    renderView({ mode: 'sign-up' })

    const confirmation = input('user.sign-in.password-confirmation-input')

    expect(confirmation.type).toBe('password')
    expect(confirmation.autocomplete).toBe('new-password')
    expect(confirmation.labels?.[0]?.textContent).toBe(en['user.sign-in.password-confirmation'])
    expect(input('user.sign-in.password-input').autocomplete).toBe('new-password')
  })

  it('tells each keystroke in either password while creating an account, with both as typed', () => {
    const { onTypePassword } = renderView({ mode: 'sign-up' })

    type('user.sign-in.password-input', 'secret-ann')
    type('user.sign-in.password-confirmation-input', 's')
    type('user.sign-in.password-confirmation-input', 'se')
    type('user.sign-in.password-input', 'secret-anx')

    expect(onTypePassword.mock.calls).toEqual([
      ['password', { password: 'secret-ann', confirmation: '' }],
      ['confirmation', { password: 'secret-ann', confirmation: 's' }],
      ['confirmation', { password: 'secret-ann', confirmation: 'se' }],
      ['password', { password: 'secret-anx', confirmation: 'se' }],
    ])
  })

  it('lists the rules of a new password under the password while creating an account only', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.password-rule-list')).toBeNull()
    expect(input('user.sign-in.password-input').getAttribute('aria-describedby')).toBeNull()
  })

  it('lists the rules under the password, describing it, none of them met with nothing typed', () => {
    renderView({ mode: 'sign-up' })

    const list = screen.getByTestId('user.sign-in.password-rule-list')
    const password = input('user.sign-in.password-input')

    expect(list.tagName).toBe('UL')
    expect(
      [...list.children].map((item) => [item.getAttribute('data-testid'), item.tagName]),
    ).toEqual(RULE_ITEMS.map((testId) => [testId, 'LI']))
    expect(markedMet()).toEqual([])
    // Under the password: in its own field, after the input, and naming it as its description.
    expect(password.closest('[data-slot="field"]')?.contains(list)).toBe(true)
    expect(password.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.getElementById(password.getAttribute('aria-describedby') ?? '')).toBe(list)
  })

  it('marks the rules the password keeps as it is typed', () => {
    renderView({ mode: 'sign-up' })

    type('user.sign-in.password-input', 'abcdefghij')
    expect(markedMet()).toEqual([LENGTH, CHARACTERS, LOWERCASE])

    type('user.sign-in.password-input', 'Abcdefghij1!')
    expect(markedMet()).toEqual(RULE_ITEMS)

    type('user.sign-in.password-input', 'Abcdefg hij1!')
    expect(markedMet()).toEqual([LENGTH, DIGIT, UPPERCASE, LOWERCASE, SYMBOL])

    type('user.sign-in.password-input', 'Abcdefghij1!Abcdefghij1!Abcdefghij1!')
    expect(markedMet()).toEqual([CHARACTERS, DIGIT, UPPERCASE, LOWERCASE, SYMBOL])
  })

  it('shows a kept rule in the success tone and one not kept yet muted, never red', () => {
    renderView({ mode: 'sign-up' })
    type('user.sign-in.password-input', 'abcdefghij')

    expect(tonesOf(LENGTH)).toEqual(['text-muted-foreground', 'text-success'])
    expect(tonesOf(SYMBOL)).toEqual(['text-muted-foreground'])

    type('user.sign-in.password-input', 'abcdefghij!')

    expect(tonesOf(SYMBOL)).toEqual(['text-muted-foreground', 'text-success'])
  })

  it('reads each rule with whether it is met, the icons left out', () => {
    renderView({ mode: 'sign-up' })
    type('user.sign-in.password-input', 'abcdefghij')

    expect(screen.getByTestId(LENGTH).textContent).toBe(
      `${en['user.password-rule.length']}${en['user.password-rule.met']}`,
    )
    expect(screen.getByTestId(SYMBOL).textContent).toBe(
      `${en['user.password-rule.symbol']}${en['user.password-rule.not-met']}`,
    )
    expect(
      screen
        .getByTestId('user.sign-in.password-rule-list')
        .querySelectorAll('svg:not([aria-hidden="true"])'),
    ).toHaveLength(0)
  })

  it('lists the rules in Spanish', () => {
    renderView({ mode: 'sign-up' }, 'es')

    expect(RULE_ITEMS.map((testId) => screen.getByTestId(testId).textContent)).toEqual(
      [
        es['user.password-rule.length'],
        es['user.password-rule.characters'],
        es['user.password-rule.digit'],
        es['user.password-rule.uppercase'],
        es['user.password-rule.lowercase'],
        es['user.password-rule.symbol'],
      ].map((text) => `${text}${es['user.password-rule.not-met']}`),
    )
  })

  it('tells no keystroke in the password while signing in', () => {
    const { onTypePassword } = renderView()

    type('user.sign-in.password-input', 'secret-ann')

    expect(onTypePassword).not.toHaveBeenCalled()
  })

  it('says the passwords differ under the password typed again, marking it invalid, and holds the submit', () => {
    renderView({
      mode: 'sign-up',
      error: PASSWORDS_DIFFER,
      can: (control) => control !== 'user.sign-in.submit-button',
    })

    const error = screen.getByTestId('user.sign-in.error')
    const confirmation = input('user.sign-in.password-confirmation-input')

    expect(error.getAttribute('data-code')).toBe('passwords-differ')
    expect(error.textContent).toBe(en['user.sign-in.error.passwords-differ'])
    expect(confirmation.getAttribute('aria-invalid')).toBe('true')
    expect(input('user.sign-in.password-input').getAttribute('aria-invalid')).toBeNull()
    // Under it: in the confirmation's own field, after the input.
    expect(confirmation.closest('[data-slot="field"]')?.contains(error)).toBe(true)
    expect(
      confirmation.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(input('user.sign-in.submit-button').disabled).toBe(true)
  })

  it('describes the password typed again by its error exactly while the passwords differ', () => {
    const props: SignInViewProps = {
      startEmail: '',
      mode: 'sign-up',
      showResend: false,
      can: () => true,
      onSubmit: () => Promise.resolve(true),
      onToggleMode: () => {},
      onTypePassword: () => {},
      onForgot: () => {},
      onResend: () => Promise.resolve(true),
    }
    const describedBy = () =>
      input('user.sign-in.password-confirmation-input').getAttribute('aria-describedby')
    const { rerender } = renderWithProviders(<SignInView {...props} error={PASSWORDS_DIFFER} />)

    expect(describedBy()).not.toBeNull()
    expect(document.getElementById(describedBy() ?? '')).toBe(
      screen.getByTestId('user.sign-in.error'),
    )

    rerender(<SignInView {...props} error={undefined} />)

    expect(describedBy()).toBeNull()

    rerender(<SignInView {...props} error="data:SIGN_UP_REJECTED" />)

    expect(describedBy()).toBeNull()
  })

  it('says it in Spanish', () => {
    renderView({ mode: 'sign-up', error: PASSWORDS_DIFFER }, 'es')

    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      es['user.sign-in.error.passwords-differ'],
    )
    expect(input('user.sign-in.password-confirmation-input').labels?.[0]?.textContent).toBe(
      es['user.sign-in.password-confirmation'],
    )
  })

  it('shows any other reason above the fields, marking none of them invalid', () => {
    renderView({ mode: 'sign-up', error: 'data:SIGN_UP_REJECTED' })

    const error = screen.getByTestId('user.sign-in.error')
    const confirmation = input('user.sign-in.password-confirmation-input')

    expect(error.getAttribute('data-code')).toBe('sign-up-rejected')
    expect(confirmation.getAttribute('aria-invalid')).toBeNull()
    expect(confirmation.closest('[data-slot="field"]')?.contains(error)).toBe(false)
    expect(
      error.compareDocumentPosition(input('user.sign-in.email-input')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('explains why the last attempt failed', () => {
    renderView({ error: 'data:INVALID_CREDENTIALS' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'invalid-credentials',
    )
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.invalid-credentials'],
    )
  })

  it('asks to wait when the gateway limits the attempts', () => {
    renderView({ error: 'data:RATE_LIMITED' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe('rate-limited')
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.rate-limited'],
    )
  })

  it('asks to sign the other account out first when another one is signed in on this browser', () => {
    renderView({ error: 'data:OTHER_ACCOUNT' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe('other-account')
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      'Another account is signed in on this browser. Sign it out first.',
    )
  })

  it('says the email is not verified yet when a sign-in was refused for it', () => {
    renderView({ error: 'data:EMAIL_NOT_VERIFIED' })

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'email-not-verified',
    )
    expect(screen.getByTestId('user.sign-in.error').textContent).toBe(
      en['user.sign-in.error.email-not-verified'],
    )
  })

  it('asks to open the link of the mail sent to the address it went to, whatever the field holds', () => {
    renderView({ mail: 'check-your-mail', sentTo: 'ann@example.test' })
    type('user.sign-in.email-input', 'bob@example.test')

    const message = screen.getByTestId('user.sign-in.mail-message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toBe(
      en['user.sign-in.mail.check-your-mail'].replace('{email}', 'ann@example.test'),
    )
  })

  it('asks it in Spanish', () => {
    renderView({ mail: 'check-your-mail', sentTo: 'ann@example.test' }, 'es')

    expect(screen.getByTestId('user.sign-in.mail-message').textContent).toBe(
      es['user.sign-in.mail.check-your-mail'].replace('{email}', 'ann@example.test'),
    )
  })

  it('shows no mail message and no resend unless told', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.mail-message')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.resend-button')).toBeNull()
  })

  it('offers to send the mail again to the email typed', () => {
    const { onResend, onSubmit } = renderView({ showResend: true })

    type('user.sign-in.email-input', 'ann@example.test')

    const resend = screen.getByTestId('user.sign-in.resend-button') as HTMLButtonElement

    expect(resend.textContent).toBe(en['user.sign-in.resend'])
    expect(resend.disabled).toBe(false)

    fireEvent.click(resend)

    expect(onResend).toHaveBeenCalledWith('ann@example.test')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('holds the resend while it cannot run', () => {
    const { onResend } = renderView({
      showResend: true,
      can: (control) => control !== 'user.sign-in.resend-button',
    })
    const resend = screen.getByTestId('user.sign-in.resend-button') as HTMLButtonElement

    expect(resend.disabled).toBe(true)

    fireEvent.click(resend)

    expect(onResend).not.toHaveBeenCalled()
  })

  it('says nothing about how the last session ended unless the session left a notice', () => {
    renderView()

    expect(screen.queryByTestId('user.sign-in.notice-message')).toBeNull()
  })

  it('asks to sign in again to send the changes this device kept when it was signed out', () => {
    renderView({ notice: 'resend-after-sign-in' })

    expect(noticeWith('resend-after-sign-in').textContent).toBe(
      en['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('asks the same in Spanish', () => {
    renderView({ notice: 'resend-after-sign-in' }, 'es')

    expect(noticeWith('resend-after-sign-in').textContent).toBe(
      es['user.sign-in.notice.resend-after-sign-in'],
    )
  })

  it('says the device was signed out from another device', () => {
    renderView({ notice: 'signed-out-elsewhere' })

    expect(noticeWith('signed-out-elsewhere').textContent).toBe(
      'You were signed out from another device.',
    )
  })

  it('shows each password as typed on a click of its eye, and hides it again on the next', () => {
    const onTypePassword = renderView({ mode: 'sign-up' }).onTypePassword

    for (const testId of [
      'user.sign-in.password-input',
      'user.sign-in.password-confirmation-input',
    ]) {
      const eye = screen.getByTestId(`${testId}.visibility-button`)

      type(testId, 'Secret-ann1')
      expect(input(testId).type).toBe('password')
      expect(eye.getAttribute('data-value')).toBe('show')
      expect(eye.getAttribute('aria-label')).toBe(en['user.password.show'])

      fireEvent.click(eye)

      expect(input(testId).type).toBe('text')
      expect(input(testId).value).toBe('Secret-ann1')
      expect(eye.getAttribute('data-value')).toBe('hide')
      expect(eye.getAttribute('aria-label')).toBe(en['user.password.hide'])

      fireEvent.click(eye)

      expect(input(testId).type).toBe('password')
      expect(eye.getAttribute('data-value')).toBe('show')
    }

    // The eye is presentation only: the flow hears the keystrokes, never the clicks.
    expect(onTypePassword).toHaveBeenCalledTimes(2)
  })

  it('offers to ask for a reset mail in the mode sign-in, carrying the email as typed', () => {
    const { onForgot } = renderView()

    type('user.sign-in.email-input', 'ann@example.test')
    fireEvent.click(screen.getByTestId('user.sign-in.forgot-link'))

    expect(onForgot).toHaveBeenCalledWith('ann@example.test')
  })

  it('offers no reset mail in the mode sign-up', () => {
    renderView({ mode: 'sign-up' })

    expect(screen.queryByTestId('user.sign-in.forgot-link')).toBeNull()
  })

  it('says the device was signed out because the password changed', () => {
    renderView({ notice: 'password-changed-elsewhere' })

    expect(noticeWith('password-changed-elsewhere').textContent).toBe(
      'Your password was changed, so you were signed out. Sign in with the new password.',
    )
  })

  it('says a new password was set in another tab, naming no account', () => {
    renderView({ notice: 'password-reset-elsewhere' })

    expect(noticeWith('password-reset-elsewhere').textContent).toBe(
      'A new password was set in another tab. Sign in with it.',
    )
  })

  it('says the data leaves this device once the other tabs are closed when another tab held its delete up', () => {
    renderView({ notice: 'delete-pending' })

    expect(noticeWith('delete-pending').textContent).toBe(
      'You are signed out. Your data leaves this device once the other Perch tabs are closed.',
    )
  })

  it('says it in Spanish', () => {
    renderView({ notice: 'signed-out-elsewhere' }, 'es')

    expect(noticeWith('signed-out-elsewhere').textContent).toBe(
      es['user.sign-in.notice.signed-out-elsewhere'],
    )
  })

  it('holds the submit while the flow does not take it', () => {
    renderView({ can: (control) => control !== 'user.sign-in.submit-button' })

    expect((screen.getByTestId('user.sign-in.submit-button') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('speaks Spanish', () => {
    renderView({}, 'es')

    expect(screen.getByTestId('user.sign-in.submit-button').textContent).toBe(
      es['user.sign-in.sign-in'],
    )
  })
})
