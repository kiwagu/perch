// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory, noteIdFactory } from '@workspace/ids'

import { renderWithProviders } from '../../../../../test-utils'
import en from '../../i18n/organisation.en.json'
import es from '../../i18n/organisation.es.json'

import {
  type MemberItem,
  type NoteItem,
  type OrganisationChoice,
  OrganisationView,
  type OrganisationViewProps,
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

const ann: MemberItem = {
  id: identityIdFactory.create(),
  email: 'ann@example.test',
  removable: false,
}
const bea: MemberItem = {
  id: identityIdFactory.create(),
  email: 'bea@example.test',
  removable: true,
}

function renderView(props: Partial<OrganisationViewProps> = {}, locale: 'en' | 'es' = 'en') {
  const handlers = {
    onCreate: vi.fn(() => Promise.resolve(true)),
    onSelect: vi.fn(),
    onAddNote: vi.fn(() => Promise.resolve(true)),
    onEditNote: vi.fn(() => Promise.resolve(true)),
    onDeleteNote: vi.fn(() => Promise.resolve(true)),
    onInvite: vi.fn(() => Promise.resolve(true)),
    onRemoveMember: vi.fn(),
  }
  const view = (more: Partial<OrganisationViewProps>) => (
    <OrganisationView
      organisations={[acme]}
      current={acme}
      notes={[hello, plans]}
      {...handlers}
      {...props}
      {...more}
    />
  )
  const { rerender } = renderWithProviders(view({}), { locale, es })

  return { ...handlers, rerender: (more: Partial<OrganisationViewProps>) => rerender(view(more)) }
}

const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

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

  it('edits a note in place', async () => {
    const { onEditNote } = renderView()
    const [first] = screen.getAllByTestId('organisation.notes.item')
    const item = first ?? expect.unreachable('a note item')

    fireEvent.click(within(item).getByTestId('organisation.notes.edit-button'))

    const input = within(item).getByTestId(
      'organisation.notes.edit-textarea',
    ) as HTMLTextAreaElement

    expect(input.value).toBe('Hello')

    fireEvent.change(input, { target: { value: 'Hello, all' } })
    fireEvent.click(within(item).getByTestId('organisation.notes.save-button'))

    expect(onEditNote).toHaveBeenCalledWith({ id: hello.id, text: 'Hello, all' })
    await waitFor(() =>
      expect(within(item).queryByTestId('organisation.notes.edit-textarea')).toBeNull(),
    )
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

  it('closes the create form when the current organisation changes', () => {
    const { rerender } = renderView({ organisations: [acme, globex] })
    const toggle = () => screen.getByTestId('organisation.create.toggle-button')

    fireEvent.click(toggle())

    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('organisation.create.form')).toBeTruthy()

    rerender({ organisations: [acme, globex], current: globex, notes: [] })

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('organisation.create.form')).toBeNull()
  })

  it('keeps the create form open when the creation fails', async () => {
    renderView({ onCreate: vi.fn(() => Promise.resolve(false)) })

    fireEvent.click(screen.getByTestId('organisation.create.toggle-button'))
    type('organisation.create.key-input', 'globex')
    type('organisation.create.name-input', 'Globex')
    fireEvent.click(screen.getByTestId('organisation.create.submit-button'))

    await waitFor(() => {
      expect(field('organisation.create.key-input').value).toBe('globex')
    })
    expect(
      screen.getByTestId('organisation.create.toggle-button').getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('shows neither the members nor the invite form', () => {
    renderView({ members: [ann, bea] })

    expect(screen.queryByTestId('organisation.members.list')).toBeNull()
    expect(screen.queryByTestId('organisation.invite.email-input')).toBeNull()
    expect(screen.queryByTestId('organisation.invite.form')).toBeNull()
  })

  it('offers to create another organisation', () => {
    const { onCreate } = renderView()

    expect(screen.queryByTestId('organisation.create.key-input')).toBeNull()

    fireEvent.click(screen.getByTestId('organisation.create.toggle-button'))
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

  it('invites an account by email and empties the field once it is invited', async () => {
    const { onInvite } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
    })

    expect(screen.getByLabelText(en['organisation.invite.email'])).toBe(
      field('organisation.invite.email-input'),
    )

    type('organisation.invite.email-input', 'bea@example.test')
    fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))

    expect(onInvite).toHaveBeenCalledWith('bea@example.test')
    await waitFor(() => expect(field('organisation.invite.email-input').value).toBe(''))
  })

  it('explains an invite the gateway refuses', () => {
    const { rerender } = renderView({
      current: acmeAdmin,
      organisations: [acmeAdmin],
      members: [ann],
    })
    const cases: ReadonlyArray<readonly [string, string, keyof typeof en]> = [
      ['no-such-identity', 'no-such-identity', 'organisation.error.no-such-identity'],
      ['already-member', 'already-member', 'organisation.error.already-member'],
      ['not-admin', 'not-admin', 'organisation.error.not-admin'],
      ['rate-limited', 'rate-limited', 'organisation.error.rate-limited'],
      ['self', 'failed', 'organisation.error.failed'],
    ]

    for (const [refusal, code, key] of cases) {
      rerender({ errors: { members: refusal } })

      const error = screen.getByTestId('organisation.invite.error')

      expect(error.getAttribute('data-code')).toBe(code)
      expect(error.textContent).toBe(en[key])
    }
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
})
