// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory, invitationIdFactory, noteIdFactory } from '@workspace/ids'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/organisation.en.json'
import es from '../../i18n/organisation.es.json'

import {
  type InviteDraft,
  type MemberItem,
  type NoteItem,
  type OrganisationChoice,
  OrganisationView,
  type OrganisationViewProps,
  type ReceivedItem,
  type SentItem,
} from './organisation.view'

const acme: OrganisationChoice = { key: 'acme', name: 'Acme', role: 'member' }
const acmeAdmin: OrganisationChoice = { ...acme, role: 'admin' }
const globex: OrganisationChoice = { key: 'globex', name: 'Globex', role: 'member' }

const hello: NoteItem = {
  id: noteIdFactory.create(),
  text: 'Hello',
  mine: true,
  editable: true,
  deletable: true,
}
const plans: NoteItem = {
  id: noteIdFactory.create(),
  text: 'Plans',
  mine: false,
  editable: false,
  deletable: false,
}
const agenda: NoteItem = { ...hello, id: noteIdFactory.create(), text: 'Agenda' }

const ann: MemberItem = {
  id: identityIdFactory.create(),
  email: 'ann@example.test',
  role: 'admin',
  removable: false,
}
const bea: MemberItem = {
  id: identityIdFactory.create(),
  email: 'bea@example.test',
  role: 'member',
  removable: true,
}

const toBea: SentItem = {
  id: invitationIdFactory.create(),
  email: 'bea@example.test',
  role: 'member',
}
const toCy: SentItem = {
  id: invitationIdFactory.create(),
  email: 'cy@example.test',
  role: 'admin',
}

const fromGlobex: ReceivedItem = {
  id: invitationIdFactory.create(),
  name: 'Globex',
  role: 'member',
}
const fromInitech: ReceivedItem = {
  id: invitationIdFactory.create(),
  name: 'Initech',
  role: 'admin',
}

/** The page with the invitation form's fields held as its container holds them. */
function Page(props: Omit<OrganisationViewProps, 'invite' | 'onInviteChange'>) {
  const [invite, setInvite] = useState<InviteDraft>({ email: '', role: 'member' })

  return <OrganisationView {...props} invite={invite} onInviteChange={setInvite} />
}

function renderView(
  props: Partial<Omit<OrganisationViewProps, 'invite' | 'onInviteChange'>> = {},
  locale: 'en' | 'es' = 'en',
) {
  const handlers = {
    onToggleCreate: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve(true)),
    onSelect: vi.fn(),
    onAddNote: vi.fn(() => Promise.resolve(true)),
    onOpenEdit: vi.fn(),
    onEditNote: vi.fn(() => Promise.resolve(true)),
    onDeleteNote: vi.fn(),
    onInvite: vi.fn(() => Promise.resolve(true)),
    onRemoveMember: vi.fn(),
    onSetRole: vi.fn(),
    onCopy: vi.fn(),
    onRevoke: vi.fn(),
    onAccept: vi.fn(),
    onDecline: vi.fn(),
  }
  const view = (more: Partial<Omit<OrganisationViewProps, 'invite' | 'onInviteChange'>>) => (
    <Page
      organisations={[acme]}
      current={acme}
      notes={[hello, plans]}
      can={() => true}
      creating={false}
      editing={undefined}
      {...handlers}
      {...props}
      {...more}
    />
  )
  const { rerender } = renderWithProviders(view({}), { locale, es })

  return {
    ...handlers,
    rerender: (more: Partial<Omit<OrganisationViewProps, 'invite' | 'onInviteChange'>>) =>
      rerender(view(more)),
  }
}

const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

/** Whether the create form is closed: hidden, with what was typed into it kept. */
const createHidden = () =>
  screen.getByTestId('organisation.create.form').closest('[hidden]') !== null

const type = (testId: string, value: string) =>
  fireEvent.change(field(testId), { target: { value } })

describe('OrganisationView without memberships', () => {
  it('says the account belongs to no organisation and offers to create one', () => {
    const { onCreate } = renderView({ organisations: [], current: undefined, notes: undefined })

    expect(screen.getByTestId('organisation.page.status').getAttribute('data-state')).toBe('empty')
    expect(screen.getByTestId('organisation.page.status').textContent).toBe(en['organisation.none'])
    expect(screen.getByTestId('organisation.create.form').tagName).toBe('FORM')
    expect(screen.getByText(en['organisation.create.title'])).toBeTruthy()
    expect(screen.getByLabelText(en['organisation.create.key'])).toBe(
      field('organisation.create.key-input'),
    )
    expect(screen.getByText(en['organisation.create.key-hint'])).toBeTruthy()

    type('organisation.create.key-input', 'acme')
    type('organisation.create.name-input', 'Acme')
    fireEvent.click(screen.getByTestId('organisation.create.submit-button'))

    expect(onCreate).toHaveBeenCalledWith({ key: 'acme', name: 'Acme' })
    expect(screen.queryByTestId('organisation.page.heading')).toBeNull()
    expect(screen.queryByTestId('organisation.notes.list')).toBeNull()
    expect(screen.queryByTestId('organisation.create.toggle-button')).toBeNull()
  })

  it('explains a key, a name or a creation the gateway refuses', () => {
    const { rerender } = renderView({ organisations: [], current: undefined, notes: undefined })
    const cases: ReadonlyArray<readonly [string, string, keyof typeof en]> = [
      ['organisation:KEY_INVALID', 'key-invalid', 'organisation.error.key-invalid'],
      ['invalid-key', 'key-invalid', 'organisation.error.key-invalid'],
      ['organisation:NAME_REQUIRED', 'name-required', 'organisation.error.name-required'],
      ['organisation:NAME_TOO_LONG', 'name-too-long', 'organisation.error.name-too-long'],
      ['key-taken', 'key-taken', 'organisation.error.key-taken'],
      ['rate-limited', 'rate-limited', 'organisation.error.rate-limited'],
      ['not-a-member', 'failed', 'organisation.error.failed'],
      ['data:OFFLINE', 'failed', 'organisation.error.failed'],
    ]

    for (const [refusal, code, key] of cases) {
      rerender({
        organisations: [],
        current: undefined,
        notes: undefined,
        errors: { create: refusal },
      })

      const error = screen.getByTestId('organisation.create.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(en[key])
    }
  })
})

describe('OrganisationView of a member', () => {
  it('shows the organisation, the role and its notes, oldest first', () => {
    renderView()

    expect(screen.getByTestId('organisation.page.heading').textContent).toBe('Acme')
    expect(screen.getByTestId('organisation.page.role-badge').getAttribute('data-value')).toBe(
      'member',
    )
    expect(screen.getByTestId('organisation.page.role-badge').textContent).toBe(
      en['organisation.role.member'],
    )

    const items = within(screen.getByTestId('organisation.notes.list')).getAllByTestId(
      'organisation.notes.item',
    )

    expect(
      items.map((item) => within(item).getByTestId('organisation.notes.text-cell').textContent),
    ).toEqual(['Hello', 'Plans'])
    expect(items.map((item) => item.getAttribute('data-id'))).toEqual([hello.id, plans.id])
    expect(screen.getByTestId('organisation.notes.section').getAttribute('data-state')).toBe(
      'ready',
    )
    expect(screen.queryByTestId('organisation.page.status')).toBeNull()
    expect(screen.queryByTestId('organisation.page.current-select')).toBeNull()
  })

  it("says the organisations' data could not be opened when memberships are listed but none is current", () => {
    renderView({ organisations: [acme, globex], current: undefined, notes: undefined })

    // A membership whose database did not open on this device: the account is a member.
    expect(screen.getByTestId('organisation.page.status').getAttribute('data-state')).toBe('error')
    expect(screen.getByTestId('organisation.page.status').textContent).toBe(
      en['organisation.unavailable'],
    )
    expect(screen.queryByTestId('organisation.page.heading')).toBeNull()
    cleanup()

    renderView({ organisations: [acme], current: undefined, notes: undefined }, 'es')

    expect(screen.getByTestId('organisation.page.status').textContent).toBe(
      es['organisation.unavailable'],
    )
  })

  it('says when the organisation has no notes yet', () => {
    renderView({ notes: [] })

    const empty = screen.getByTestId('organisation.notes.empty-message')

    expect(empty.getAttribute('data-code')).toBe('no-notes')
    expect(empty.textContent).toBe(en['organisation.notes.empty'])
    expect(screen.getByTestId('organisation.notes.section').getAttribute('data-state')).toBe(
      'empty',
    )
    expect(screen.queryByTestId('organisation.notes.item')).toBeNull()
  })

  it('says the notes are being read until they are', () => {
    renderView({ notes: undefined })

    expect(screen.getByTestId('organisation.notes.section').getAttribute('data-state')).toBe(
      'loading',
    )
    expect(screen.queryByTestId('organisation.notes.list')).toBeNull()
    expect(screen.queryByTestId('organisation.notes.empty-message')).toBeNull()
  })

  it('adds a note and empties the field once it is written', async () => {
    const { onAddNote } = renderView()

    expect(field('organisation.notes.new-textarea').placeholder).toBe(
      en['organisation.notes.placeholder'],
    )
    expect(field('organisation.notes.new-textarea').maxLength).toBe(500)

    type('organisation.notes.new-textarea', 'New plan')
    fireEvent.click(screen.getByTestId('organisation.notes.add-button'))

    expect(onAddNote).toHaveBeenCalledWith('New plan')
    await waitFor(() => expect(field('organisation.notes.new-textarea').value).toBe(''))
  })

  it('keeps a note that was refused in the field and explains why', async () => {
    const { onAddNote, rerender } = renderView()

    onAddNote.mockResolvedValueOnce(false)
    type('organisation.notes.new-textarea', '   ')
    fireEvent.click(screen.getByTestId('organisation.notes.add-button'))
    rerender({ errors: { notes: 'note:TEXT_REQUIRED' } })

    await act(() => Promise.resolve())

    expect(field('organisation.notes.new-textarea').value).toBe('   ')
    expect(screen.getByTestId('organisation.notes.error').getAttribute('data-code')).toBe(
      'text-required',
    )
    expect(screen.getByTestId('organisation.notes.error').textContent).toBe(
      en['organisation.error.text-required'],
    )

    rerender({ errors: { notes: 'note:TEXT_TOO_LONG' } })

    expect(screen.getByTestId('organisation.notes.error').getAttribute('data-code')).toBe(
      'text-too-long',
    )
    expect(screen.getByTestId('organisation.notes.error').textContent).toBe(
      en['organisation.error.text-too-long'],
    )
  })

  it('edits a note in place', () => {
    const { onOpenEdit, onEditNote, rerender } = renderView()
    const [first] = screen.getAllByTestId('organisation.notes.item')
    const item = first ?? expect.unreachable('a note item')

    fireEvent.click(within(item).getByTestId('organisation.notes.edit-button'))

    expect(onOpenEdit).toHaveBeenCalledWith(hello.id)

    rerender({ editing: hello.id })

    const input = within(item).getByTestId(
      'organisation.notes.edit-textarea',
    ) as HTMLTextAreaElement

    expect(input.value).toBe('Hello')

    fireEvent.change(input, { target: { value: 'Hello, all' } })
    fireEvent.click(within(item).getByTestId('organisation.notes.save-button'))

    expect(onEditNote).toHaveBeenCalledWith({ id: hello.id, text: 'Hello, all' })

    rerender({ editing: undefined })

    expect(within(item).queryByTestId('organisation.notes.edit-textarea')).toBeNull()
    expect(within(item).getByTestId('organisation.notes.text-cell').textContent).toBe('Hello')
  })

  it('shows one edit form, and drops what was typed into it when another note opens its own', () => {
    const { rerender } = renderView({ notes: [hello, agenda], editing: hello.id })

    expect(screen.getAllByTestId('organisation.notes.edit-textarea')).toHaveLength(1)

    type('organisation.notes.edit-textarea', 'Hello, all')
    rerender({ notes: [hello, agenda], editing: agenda.id })

    const [first, second] = screen.getAllByTestId('organisation.notes.item')

    expect(
      within(first ?? expect.unreachable('a note item')).getByTestId('organisation.notes.text-cell')
        .textContent,
    ).toBe('Hello')
    expect(field('organisation.notes.edit-textarea').value).toBe('Agenda')
    expect(
      within(second ?? expect.unreachable('a second note item')).getByTestId(
        'organisation.notes.edit-textarea',
      ),
    ).toBeTruthy()

    rerender({ notes: [hello, agenda], editing: hello.id })

    expect(field('organisation.notes.edit-textarea').value).toBe('Hello')
  })

  it("disables the controls the page's flow does not take now", () => {
    renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin, globex],
      members: [ann, bea],
      sent: [toBea],
      received: [fromGlobex],
      can: (event) => event.type === 'organisation.notes.add-button',
    })

    for (const testId of [
      'organisation.notes.edit-button',
      'organisation.notes.delete-button',
      'organisation.invite.submit-button',
      'organisation.members.remove-button',
      'organisation.sent.copy-button',
      'organisation.sent.revoke-button',
      'organisation.received.accept-button',
      'organisation.received.decline-button',
      'organisation.create.toggle-button',
      'organisation.create.submit-button',
    ]) {
      expect((screen.getByTestId(testId) as HTMLButtonElement).disabled, testId).toBe(true)
    }

    expect(
      (screen.getByTestId('organisation.notes.add-button') as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(
      screen.getByTestId('organisation.page.current-select').hasAttribute('data-disabled'),
    ).toBe(true)

    for (const select of screen.getAllByTestId('organisation.members.role-select')) {
      expect(select.hasAttribute('data-disabled')).toBe(true)
    }
  })

  it('shows "Yours" and the edit and delete buttons only on the notes the member may change', () => {
    renderView()

    const [first, second] = screen.getAllByTestId('organisation.notes.item')
    const mine = first ?? expect.unreachable('a note item')
    const others = second ?? expect.unreachable('a second note item')

    expect(within(mine).getByTestId('organisation.notes.mine-badge').textContent).toBe(
      en['organisation.notes.mine'],
    )
    expect(within(mine).getByTestId('organisation.notes.edit-button')).toBeTruthy()
    expect(within(mine).getByTestId('organisation.notes.delete-button').textContent).toBe(
      en['organisation.notes.delete'],
    )
    expect(within(others).queryByTestId('organisation.notes.mine-badge')).toBeNull()
    expect(within(others).queryByTestId('organisation.notes.edit-button')).toBeNull()
    expect(within(others).queryByTestId('organisation.notes.delete-button')).toBeNull()
  })

  it('deletes a note', () => {
    const { onDeleteNote } = renderView()

    fireEvent.click(screen.getByTestId('organisation.notes.delete-button'))

    expect(onDeleteNote).toHaveBeenCalledWith(hello.id)
  })

  it('explains a change the rules forbid', () => {
    renderView({ errors: { notes: 'note:FORBIDDEN' } })

    expect(screen.getByTestId('organisation.notes.error').getAttribute('data-code')).toBe(
      'forbidden',
    )
    expect(screen.getByTestId('organisation.notes.error').textContent).toBe(
      'Only the author or an administrator can change this note.',
    )
  })

  it('starts the forms afresh when another organisation becomes current', () => {
    const { rerender } = renderView({ organisations: [acme, globex] })

    type('organisation.notes.new-textarea', 'Draft for Acme')
    rerender({ organisations: [acme, globex], current: globex, notes: [] })

    expect(screen.getByTestId('organisation.page.heading').textContent).toBe('Globex')
    expect(field('organisation.notes.new-textarea').value).toBe('')
  })

  it('keeps what was typed into the create form while its toggle closes and opens it', () => {
    const { onToggleCreate, rerender } = renderView({ organisations: [acme, globex] })
    const toggle = () => screen.getByTestId('organisation.create.toggle-button')

    fireEvent.click(toggle())

    expect(onToggleCreate).toHaveBeenCalledTimes(1)

    rerender({ organisations: [acme, globex], creating: true })
    type('organisation.create.key-input', 'initech')
    rerender({ organisations: [acme, globex], creating: false })

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(createHidden()).toBe(true)

    rerender({ organisations: [acme, globex], creating: true })

    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(createHidden()).toBe(false)
    expect(field('organisation.create.key-input').value).toBe('initech')
  })

  it('starts the create form afresh when another organisation becomes current', () => {
    const { rerender } = renderView({ organisations: [acme, globex], creating: true })

    type('organisation.create.key-input', 'initech')
    rerender({ organisations: [acme, globex], current: globex, notes: [], creating: false })

    expect(createHidden()).toBe(true)
    expect(field('organisation.create.key-input').value).toBe('')
  })

  it('keeps what was typed into the create form when the creation fails', async () => {
    const onCreate = vi.fn(() => Promise.resolve(false))

    renderView({ creating: true, onCreate })

    type('organisation.create.key-input', 'globex')
    type('organisation.create.name-input', 'Globex')
    fireEvent.click(screen.getByTestId('organisation.create.submit-button'))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ key: 'globex', name: 'Globex' }))
    await act(() => Promise.resolve())

    expect(field('organisation.create.key-input').value).toBe('globex')
    expect(field('organisation.create.name-input').value).toBe('Globex')
  })

  it('shows neither the members nor the invite form', () => {
    renderView({ members: [ann, bea] })

    expect(screen.queryByTestId('organisation.members.list')).toBeNull()
    expect(screen.queryByTestId('organisation.invite.email-input')).toBeNull()
    expect(screen.queryByTestId('organisation.invite.form')).toBeNull()
  })

  it('offers to create another organisation', () => {
    const { onCreate, rerender } = renderView()

    expect(createHidden()).toBe(true)

    rerender({ creating: true })
    type('organisation.create.key-input', 'globex')
    type('organisation.create.name-input', 'Globex')
    fireEvent.click(screen.getByTestId('organisation.create.submit-button'))

    expect(onCreate).toHaveBeenCalledWith({ key: 'globex', name: 'Globex' })
  })

  it('offers a choice between organisations when it belongs to several', async () => {
    const { onSelect } = renderView({ organisations: [acme, globex] })
    const select = screen.getByTestId('organisation.page.current-select')

    expect(select.textContent).toContain('Acme')
    expect(screen.getByLabelText(en['organisation.select'])).toBe(select)

    const user = userEvent.setup()

    await user.click(select)

    const options = await screen.findAllByTestId('organisation.page.current-select.option')

    expect(options.map((option) => option.getAttribute('data-value'))).toEqual(['acme', 'globex'])

    await user.click(await screen.findByRole('option', { name: 'Globex' }))

    expect(onSelect).toHaveBeenCalledWith('globex')
  })
})

describe('OrganisationView of an administrator', () => {
  it('shows the role and the members, and removes a member other than itself', () => {
    const { onRemoveMember } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann, bea],
    })

    expect(screen.getByTestId('organisation.page.role-badge').getAttribute('data-value')).toBe(
      'admin',
    )
    expect(screen.getByTestId('organisation.page.role-badge').textContent).toBe(
      en['organisation.role.admin'],
    )
    expect(screen.getByTestId('organisation.invite.form').tagName).toBe('FORM')

    const items = within(screen.getByTestId('organisation.members.list')).getAllByTestId(
      'organisation.members.item',
    )
    const [self, other] = items

    expect(items.map((item) => item.getAttribute('data-id'))).toEqual([ann.id, bea.id])

    expect(items.map((item) => item.textContent?.includes('@example.test'))).toEqual([true, true])
    expect(self?.textContent).toContain('ann@example.test')
    expect(
      within(self ?? expect.unreachable('ann')).queryByTestId('organisation.members.remove-button'),
    ).toBeNull()

    const remove = within(other ?? expect.unreachable('bea')).getByTestId(
      'organisation.members.remove-button',
    )

    expect(remove.textContent).toBe(en['organisation.members.remove'])

    fireEvent.click(remove)

    expect(onRemoveMember).toHaveBeenCalledWith(bea.id)
  })

  it('shows a role select on every member row, its own included, and no remove button on its own row', () => {
    renderView({ current: acmeAdmin, organisations: [acmeAdmin], members: [ann, bea] })

    const items = within(screen.getByTestId('organisation.members.list')).getAllByTestId(
      'organisation.members.item',
    )
    const selects = items.map((item) =>
      within(item).getByTestId('organisation.members.role-select'),
    )

    expect(selects.map((select) => select.getAttribute('data-value'))).toEqual(['admin', 'member'])
    expect(selects.map((select) => select.textContent)).toEqual([
      expect.stringContaining(en['organisation.role.admin']),
      expect.stringContaining(en['organisation.role.member']),
    ])

    for (const select of selects) {
      expect(select.getAttribute('aria-label')).toBe(en['organisation.members.role'])
    }
  })

  it('changes a role at once, choosing another option of the row select', async () => {
    const { onSetRole } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann, bea],
    })
    const [, other] = screen.getAllByTestId('organisation.members.item')
    const user = userEvent.setup()

    await user.click(
      within(other ?? expect.unreachable('bea')).getByTestId('organisation.members.role-select'),
    )

    const options = await screen.findAllByTestId('organisation.members.role-select.option')

    expect(options.map((option) => option.getAttribute('data-value'))).toEqual(['member', 'admin'])

    await user.click(await screen.findByRole('option', { name: en['organisation.role.admin'] }))

    expect(onSetRole).toHaveBeenCalledWith(bea.id, 'admin')
  })

  it('shows the role the row is given: the one being set, or the one kept after a refusal', () => {
    const { rerender } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann, { ...bea, role: 'admin' }],
    })
    const roles = () =>
      screen
        .getAllByTestId('organisation.members.role-select')
        .map((select) => select.getAttribute('data-value'))

    expect(roles()).toEqual(['admin', 'admin'])

    rerender({ members: [ann, bea] })

    expect(roles()).toEqual(['admin', 'member'])
  })

  it('invites an email with the role member until another is chosen, and keeps what was typed for the page to empty', async () => {
    const { onInvite } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
    })
    const select = screen.getByTestId('organisation.invite.role-select')

    expect(screen.getByLabelText(en['organisation.invite.email'])).toBe(
      field('organisation.invite.email-input'),
    )
    expect(field('organisation.invite.email-input').type).toBe('email')
    expect(select.getAttribute('data-value')).toBe('member')
    expect(select.getAttribute('aria-label')).toBe(en['organisation.invite.role'])

    type('organisation.invite.email-input', 'bea@example.test')
    fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))

    expect(onInvite).toHaveBeenCalledWith('bea@example.test', 'member')
    await act(() => Promise.resolve())

    expect(field('organisation.invite.email-input').value).toBe('bea@example.test')
  })

  it('invites with the administrator role once it is chosen', async () => {
    const { onInvite } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
    })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('organisation.invite.role-select'))

    const options = await screen.findAllByTestId('organisation.invite.role-select.option')

    expect(options.map((option) => option.getAttribute('data-value'))).toEqual(['member', 'admin'])

    await user.click(await screen.findByRole('option', { name: en['organisation.role.admin'] }))

    expect(screen.getByTestId('organisation.invite.role-select').getAttribute('data-value')).toBe(
      'admin',
    )

    type('organisation.invite.email-input', 'cy@example.test')
    fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))

    expect(onInvite).toHaveBeenCalledWith('cy@example.test', 'admin')
  })

  it('explains an invite, a role change or a removal the gateway refuses', () => {
    const { rerender } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
    })
    const cases: ReadonlyArray<readonly [string, string, keyof typeof en]> = [
      ['already-member', 'already-member', 'organisation.error.already-member'],
      ['email-invalid', 'email-invalid', 'organisation.error.email-invalid'],
      ['not-admin', 'not-admin', 'organisation.error.not-admin'],
      ['last-admin', 'last-admin', 'organisation.error.last-admin'],
      ['rate-limited', 'rate-limited', 'organisation.error.rate-limited'],
      ['clipboard:REFUSED', 'failed', 'organisation.error.failed'],
      ['self', 'failed', 'organisation.error.failed'],
    ]

    for (const [refusal, code, key] of cases) {
      rerender({ errors: { members: refusal } })

      const error = screen.getByTestId('organisation.invite.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(en[key])
    }
  })

  it('lists the invitations not accepted yet, each with its email, its role, a copy and a revoke', () => {
    const { onCopy, onRevoke } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
      sent: [toBea, toCy],
    })
    const list = screen.getByTestId('organisation.sent.list')
    const items = within(list).getAllByTestId('organisation.sent.item')
    const [first, second] = items

    expect(
      screen.getByRole('heading', { level: 2, name: en['organisation.sent.title'] }),
    ).toBeTruthy()
    expect(items.map((item) => item.getAttribute('data-id'))).toEqual([toBea.id, toCy.id])
    expect(
      items.map((item) => within(item).getByTestId('organisation.sent.email-cell').textContent),
    ).toEqual(['bea@example.test', 'cy@example.test'])

    const badges = items.map((item) => within(item).getByTestId('organisation.sent.role-badge'))

    expect(badges.map((badge) => badge.getAttribute('data-value'))).toEqual(['member', 'admin'])
    expect(badges.map((badge) => badge.textContent)).toEqual([
      en['organisation.role.member'],
      en['organisation.role.admin'],
    ])

    const copy = within(first ?? expect.unreachable('first')).getByTestId(
      'organisation.sent.copy-button',
    )
    const revoke = within(second ?? expect.unreachable('second')).getByTestId(
      'organisation.sent.revoke-button',
    )

    expect(copy.textContent).toBe(en['organisation.sent.copy'])
    expect(revoke.textContent).toBe(en['organisation.sent.revoke'])

    fireEvent.click(copy)
    fireEvent.click(revoke)

    expect(onCopy).toHaveBeenCalledWith(toBea.id)
    expect(onRevoke).toHaveBeenCalledWith(toCy.id)
  })

  it('lists one invitation as well as several', () => {
    renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
      sent: [toBea],
    })

    expect(screen.getAllByTestId('organisation.sent.item')).toHaveLength(1)
  })

  it('shows no invitations while there are none, or before they are read', () => {
    const { rerender } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
      sent: undefined,
    })

    expect(screen.queryByTestId('organisation.sent.list')).toBeNull()

    rerender({ sent: [] })

    expect(screen.queryByTestId('organisation.sent.list')).toBeNull()
    expect(screen.queryByText(en['organisation.sent.title'])).toBeNull()
  })
})

describe('OrganisationView of the invitations for the account', () => {
  it('lists them without a membership, above the create form, and accepts or declines one', () => {
    const { onAccept, onDecline } = renderView({
      organisations: [],
      current: undefined,
      notes: undefined,
      received: [fromGlobex, fromInitech],
    })

    expect(screen.getByTestId('organisation.page.status').getAttribute('data-state')).toBe('empty')

    const list = screen.getByTestId('organisation.received.list')
    const items = within(list).getAllByTestId('organisation.received.item')
    const [first, second] = items

    expect(
      screen.getByRole('heading', { level: 2, name: en['organisation.received.title'] }),
    ).toBeTruthy()
    expect(items.map((item) => item.getAttribute('data-id'))).toEqual([
      fromGlobex.id,
      fromInitech.id,
    ])
    expect(
      items.map((item) => within(item).getByTestId('organisation.received.name-cell').textContent),
    ).toEqual(['Globex', 'Initech'])
    expect(
      items.map((item) =>
        within(item).getByTestId('organisation.received.role-badge').getAttribute('data-value'),
      ),
    ).toEqual(['member', 'admin'])
    expect(
      screen.getByTestId('organisation.create.form').compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()

    const accept = within(first ?? expect.unreachable('first')).getByTestId(
      'organisation.received.accept-button',
    )
    const decline = within(second ?? expect.unreachable('second')).getByTestId(
      'organisation.received.decline-button',
    )

    expect(accept.textContent).toBe(en['organisation.received.accept'])
    expect(decline.textContent).toBe(en['organisation.received.decline'])

    fireEvent.click(accept)
    fireEvent.click(decline)

    expect(onAccept).toHaveBeenCalledWith(fromGlobex.id)
    expect(onDecline).toHaveBeenCalledWith(fromInitech.id)
  })

  it('lists them for a member too, whose page shows no members and no invitations sent', () => {
    renderView({ received: [fromGlobex], sent: [toBea], members: [ann, bea] })

    expect(screen.getAllByTestId('organisation.received.item')).toHaveLength(1)
    expect(screen.queryByTestId('organisation.sent.list')).toBeNull()
    expect(screen.queryByTestId('organisation.members.list')).toBeNull()
  })

  it('shows no list while there are no invitations, or before they are read', () => {
    const { rerender } = renderView({ received: undefined })

    expect(screen.queryByTestId('organisation.received.list')).toBeNull()

    rerender({ received: [] })

    expect(screen.queryByTestId('organisation.received.list')).toBeNull()
    expect(screen.queryByText(en['organisation.received.title'])).toBeNull()
  })

  it('shows what failed in place of the list', () => {
    const { rerender } = renderView({
      received: [fromGlobex],
      errors: { received: 'invitation-gone' },
    })
    const cases: ReadonlyArray<readonly [string, string, keyof typeof en]> = [
      ['invitation-gone', 'invitation-gone', 'organisation.error.invitation-gone'],
      ['other-account', 'other-account', 'organisation.error.other-account'],
      ['already-member', 'already-member', 'organisation.error.already-member'],
      ['data:OFFLINE', 'failed', 'organisation.error.failed'],
    ]

    for (const [refusal, code, key] of cases) {
      rerender({ received: [fromGlobex], errors: { received: refusal } })

      const error = screen.getByTestId('organisation.received.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(en[key])
      expect(screen.queryByTestId('organisation.received.list')).toBeNull()
    }

    rerender({ received: undefined, errors: { received: 'data:OFFLINE' } })

    expect(screen.getByTestId('organisation.received.error').getAttribute('data-code')).toBe(
      'failed',
    )

    rerender({ received: [fromGlobex], errors: {} })

    expect(screen.queryByTestId('organisation.received.error')).toBeNull()
    expect(screen.getByTestId('organisation.received.list')).toBeTruthy()
  })
})

describe('OrganisationView in Spanish', () => {
  it('speaks Spanish', () => {
    renderView({ organisations: [], current: undefined, notes: undefined }, 'es')

    expect(screen.getByTestId('organisation.page.status').textContent).toBe(es['organisation.none'])
    expect(screen.getByTestId('organisation.create.submit-button').textContent).toBe(
      es['organisation.create.submit'],
    )
  })

  it('speaks Spanish on the members, the invitations and the invitations for the account', () => {
    renderView(
      {
        current: acmeAdmin,
        organisations: [acmeAdmin],
        members: [ann, bea],
        sent: [toBea],
        received: [fromGlobex],
      },
      'es',
    )

    expect(screen.getByTestId('organisation.invite.submit-button').textContent).toBe(
      es['organisation.invite.submit'],
    )
    expect(screen.getByTestId('organisation.sent.copy-button').textContent).toBe(
      es['organisation.sent.copy'],
    )
    expect(screen.getByTestId('organisation.sent.revoke-button').textContent).toBe(
      es['organisation.sent.revoke'],
    )
    expect(screen.getByText(es['organisation.sent.title'])).toBeTruthy()
    expect(screen.getByText(es['organisation.received.title'])).toBeTruthy()
    expect(screen.getByTestId('organisation.received.accept-button').textContent).toBe(
      es['organisation.received.accept'],
    )
    expect(screen.getByTestId('organisation.received.decline-button').textContent).toBe(
      es['organisation.received.decline'],
    )
    expect(
      screen.getAllByTestId('organisation.members.role-select')[0]?.getAttribute('aria-label'),
    ).toBe(es['organisation.members.role'])
  })
})
