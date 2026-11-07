// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { replicaSchema } from '@workspace/database/replica-schema'
import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory, invitationIdFactory } from '@workspace/ids'

import {
  gatewayWith,
  later,
  membership,
  noInvitations,
  sessionIn,
  unavailable,
} from '../../../../../platform/__fixtures__/organisations'
import { fakeServices } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { CLIPBOARD } from '../../../../../platform/clipboard.port'
import { defineModule } from '../../../../../platform/module'
import type {
  InvitationView,
  MemberView,
  OrganisationsPort,
} from '../../../../../platform/organisations.port'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import { NOTES_SERVICE, NotesService } from '../../../application/notes.service'
import {
  ORGANISATION_SERVICE,
  OrganisationService,
} from '../../../application/organisation.service'
import en from '../../i18n/organisation.en.json'

import { OrganisationContainer } from './organisation.container'
import { organisationCommands, organisationShape } from './organisation.model.gen'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bea = { id: identityIdFactory.create(), email: 'bea@example.test' }

const annAdmin: MemberView = { identity: ann, role: 'admin' }
const beaMember: MemberView = { identity: bea, role: 'member' }

const sentToBea: InvitationView = {
  id: invitationIdFactory.create(),
  email: bea.email,
  role: 'member',
  link: 'https://perch.example.test/invitation?token=t',
}

const acme = membership('acme', 'Acme', 'admin')
const globex = membership('globex', 'Globex', 'admin')

/**
 * The organisation page of `ann`, a member of `memberships` (the first is current), over
 * `gateway`. `select` makes another organisation current without the page choosing it.
 */
async function openPage(memberships: Parameters<typeof sessionIn>[1], gateway: OrganisationsPort) {
  const { session, select } = sessionIn(ann, memberships)
  const organisations = new OrganisationService(session, gateway, noInvitations, replicaSchema)
  const services = fakeServices(session)

  services.container
    .singleton(ORGANISATION_SERVICE, () => organisations)
    .singleton(
      NOTES_SERVICE,
      () =>
        new NotesService(
          services.runner,
          { execute: unavailable },
          { shape: organisationShape, commands: organisationCommands },
          () => organisations.ability(),
        ),
    )
    .singleton(CLIPBOARD, () => ({ write: () => okAsync(undefined) }))

  const TestModule = defineModule({
    id: 'test',
    declarations: { Organisation: OrganisationContainer },
    routes: [{ path: '/org', page: 'Organisation', guard: 'authenticated' }],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: ['/org'] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )
  await screen.findByTestId('organisation.invite.email-input')

  return { select }
}

const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement

const type = (testId: string, value: string) =>
  fireEvent.change(field(testId), { target: { value } })

/** The row of a member, once the list shows it. */
async function rowOf(member: MemberView): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('organisation.members.item')

  return (
    rows.find((each) => each.getAttribute('data-id') === member.identity.id) ??
    expect.unreachable(member.identity.email)
  )
}

/** The role the select of a member's row shows. */
async function roleOf(member: MemberView): Promise<string | null> {
  return within(await rowOf(member))
    .getByTestId('organisation.members.role-select')
    .getAttribute('data-value')
}

/** Chooses the administrator role on the row of a member. */
async function makeAdmin(member: MemberView): Promise<void> {
  const user = userEvent.setup()

  await user.click(within(await rowOf(member)).getByTestId('organisation.members.role-select'))
  await user.click(await screen.findByRole('option', { name: en['organisation.role.admin'] }))
}

describe('OrganisationContainer', () => {
  describe('the invitation form', () => {
    it('empties once the invitation is sent', async () => {
      const sent = later<InvitationView>()
      const invite = vi.fn(() => sent.result)

      await openPage([acme], gatewayWith({ invite }))
      type('organisation.invite.email-input', 'bea@example.test')
      fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))
      await waitFor(() => expect(invite).toHaveBeenCalledWith('acme', 'bea@example.test', 'member'))

      expect(field('organisation.invite.email-input').value).toBe('bea@example.test')

      await act(async () => {
        sent.done(sentToBea)
      })

      await waitFor(() => expect(field('organisation.invite.email-input').value).toBe(''))
    })

    it('is left as typed when an invitation is sent in an organisation that stopped being current meanwhile', async () => {
      const sent = later<InvitationView>()
      const invite = vi.fn(() => sent.result)
      const invitations = vi.fn(() => okAsync([]))
      const { select } = await openPage([acme, globex], gatewayWith({ invite, invitations }))

      type('organisation.invite.email-input', 'late@example.test')
      fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))
      await waitFor(() =>
        expect(invite).toHaveBeenCalledWith('acme', 'late@example.test', 'member'),
      )

      // The membership in Acme goes away on another device, which makes Globex current here.
      act(() => select('globex'))
      await waitFor(() => expect(invitations).toHaveBeenCalledWith('globex'))
      type('organisation.invite.email-input', 'cy@example.test')
      await act(async () => {
        sent.done(sentToBea)
      })

      // The invitations are read again once the late invitation is done, after its clears.
      await waitFor(() => expect(invitations).toHaveBeenCalledTimes(3))

      expect(field('organisation.invite.email-input').value).toBe('cy@example.test')
    })
  })

  describe("a member's role select", () => {
    it('keeps the role just set until the members read after the change settle', async () => {
      const reread = later<readonly MemberView[]>()
      let reads = 0
      const members = vi.fn(() => (++reads === 1 ? okAsync([annAdmin, beaMember]) : reread.result))
      const setRole = vi.fn(() => okAsync(undefined))

      await openPage([acme], gatewayWith({ members, setRole }))

      expect(await roleOf(beaMember)).toBe('member')

      await makeAdmin(beaMember)
      await waitFor(() => expect(setRole).toHaveBeenCalledWith('acme', bea.id, 'admin'))
      // The members are read again once the change is done; that read has not come yet.
      await waitFor(() => expect(members).toHaveBeenCalledTimes(2))

      expect(await roleOf(beaMember)).toBe('admin')

      await act(async () => {
        reread.done([annAdmin, { ...beaMember, role: 'admin' }])
      })

      expect(await roleOf(beaMember)).toBe('admin')
    })

    it('shows what the members read after the change lists once it settled', async () => {
      const reread = later<readonly MemberView[]>()
      let reads = 0
      const members = vi.fn(() => (++reads === 1 ? okAsync([annAdmin, beaMember]) : reread.result))

      await openPage([acme], gatewayWith({ members }))
      await makeAdmin(beaMember)
      await waitFor(() => expect(members).toHaveBeenCalledTimes(2))

      expect(await roleOf(beaMember)).toBe('admin')

      // Another administrator put the member back meanwhile: the list is what the select shows.
      await act(async () => {
        reread.done([annAdmin, beaMember])
      })

      await waitFor(async () => expect(await roleOf(beaMember)).toBe('member'))
    })

    it('shows the role the member keeps when the change is refused', async () => {
      const change = later<void>()
      const setRole = vi.fn(() => change.result)

      await openPage(
        [acme],
        gatewayWith({ members: () => okAsync([annAdmin, beaMember]), setRole }),
      )
      await makeAdmin(beaMember)
      await waitFor(() => expect(setRole).toHaveBeenCalled())

      expect(await roleOf(beaMember)).toBe('admin')

      await act(async () => {
        change.refuse('not-admin')
      })

      await waitFor(async () => expect(await roleOf(beaMember)).toBe('member'))
      expect(screen.getByTestId('organisation.invite.error').getAttribute('data-code')).toBe(
        'not-admin',
      )
    })
  })
})
