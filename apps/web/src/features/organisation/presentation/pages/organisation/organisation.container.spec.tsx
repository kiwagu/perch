// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import type { BusError } from '@workspace/cqrs'
import { replicaSchema } from '@workspace/database/replica-schema'
import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory, invitationIdFactory } from '@workspace/ids'
import { CONTRACT_ROLES, CONTRACT_ROUTES } from '@workspace/kernel'

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
import type { CommandsPort } from '../../../../../platform/commands.port'
import type { InvitationsPort, ReceivedInvitation } from '../../../../../platform/invitations.port'
import { defineModule } from '../../../../../platform/module'
import type {
  InvitationView,
  MemberView,
  OrganisationsPort,
} from '../../../../../platform/organisations.port'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { TenantCommandsPort } from '../../../../../platform/tenant-commands.port'
import { NOTES_SERVICE, NotesService } from '../../../application/notes.service'
import {
  ORGANISATION_SERVICE,
  OrganisationService,
} from '../../../application/organisation.service'
import {
  organisationSettingsCommands,
  organisationSettingsShape,
} from '../../../application/organisation-settings/organisation-settings.model.gen'
import {
  ORGANISATION_SETTINGS_SERVICE,
  OrganisationSettingsService,
} from '../../../application/organisation-settings/organisation-settings.service'
import { organisationSettingsIdOf } from '../../../application/organisation-settings/organisation-settings-id'
import en from '../../i18n/organisation.en.json'

import { OrganisationContainer } from './organisation.container'
import { organisationCommands, organisationShape } from './organisation.model.gen'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bea = { id: identityIdFactory.create(), email: 'bea@example.test' }

const annAdmin: MemberView = { identity: ann, role: CONTRACT_ROLES.admin }
const beaMember: MemberView = { identity: bea, role: CONTRACT_ROLES.member }

const sentToBea: InvitationView = {
  id: invitationIdFactory.create(),
  email: bea.email,
  role: CONTRACT_ROLES.member,
  link: 'https://perch.example.test/invitation?token=t',
}

type Membership = ReturnType<typeof membership>

const acme = membership('acme', 'Acme', CONTRACT_ROLES.admin)
const globex = membership('globex', 'Globex', CONTRACT_ROLES.admin)

const fromInitech: ReceivedInvitation = {
  id: invitationIdFactory.create(),
  organisation: { name: 'Initech' },
  role: CONTRACT_ROLES.member,
}

/** The commands asked of each organisation by key, each answered as `answer` says. */
function tenantsAnswering(answer: () => ResultAsync<void, BusError>) {
  const asked: string[] = []
  const tenants: TenantCommandsPort = {
    forTenant: (key) => ({
      execute: (command) => {
        asked.push(`${key} ${command.id}`)

        return answer()
      },
    }),
  }

  return { tenants, asked }
}

/**
 * The organisation page of `ann`, a member of `memberships` (the first is current), over
 * `gateway`, the invitations to her (`invitations`), the commands that write her notes
 * (`commands`, none that works by default) and those that write an organisation's settings
 * (`tenants`, none that works by default), with the settings row `settings` on the device (none by
 * default). `select` makes another organisation current without the page choosing it.
 */
async function openPage(
  memberships: Parameters<typeof sessionIn>[1],
  gateway: OrganisationsPort,
  invitations: InvitationsPort = noInvitations,
  commands: CommandsPort = { execute: unavailable },
  tenants: TenantCommandsPort = tenantsAnswering(unavailable).tenants,
  settings: readonly { readonly id: ReturnType<typeof organisationSettingsIdOf> }[] = [],
) {
  const { session, select } = sessionIn(ann, memberships)
  const organisations = new OrganisationService(session, gateway, invitations, replicaSchema)
  const services = fakeServices(session)

  services.runner.set(organisationSettingsShape, settings)

  services.container
    .singleton(ORGANISATION_SERVICE, () => organisations)
    .singleton(
      NOTES_SERVICE,
      () =>
        new NotesService(
          services.runner,
          commands,
          { shape: organisationShape, commands: organisationCommands },
          () => organisations.ability(),
        ),
    )
    .singleton(
      ORGANISATION_SETTINGS_SERVICE,
      () =>
        new OrganisationSettingsService(
          tenants,
          { commands: organisationSettingsCommands },
          () => organisations.ability(),
          () => true,
        ),
    )
    .singleton(CLIPBOARD, () => ({ write: () => okAsync(undefined) }))

  const TestModule = defineModule({
    id: 'test',
    declarations: { Organisation: OrganisationContainer },
    routes: [
      {
        path: CONTRACT_ROUTES.organisation,
        page: 'Organisation',
        guard: 'authenticated',
        roles: [CONTRACT_ROLES.identity, CONTRACT_ROLES.member, CONTRACT_ROLES.admin],
      },
    ],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [CONTRACT_ROUTES.organisation] }),
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
  describe("the organisation's default language", () => {
    const members = () => okAsync([annAdmin])

    it("takes no choice before the organisation's settings are on this device", async () => {
      await openPage([acme], gatewayWith({ members }))

      expect(
        screen.getByTestId('organisation.settings.locale-select').hasAttribute('data-disabled'),
      ).toBe(true)
    })

    it('stores the language chosen in the organisation acted on, even once another is current', async () => {
      const change = later<void>()
      const { tenants, asked } = tenantsAnswering(() => change.result)
      const user = userEvent.setup()
      const { select } = await openPage(
        [acme, globex],
        gatewayWith({ members }),
        noInvitations,
        { execute: unavailable },
        tenants,
        [{ id: organisationSettingsIdOf('acme') }],
      )

      await waitFor(() =>
        expect(
          screen.getByTestId('organisation.settings.locale-select').hasAttribute('data-disabled'),
        ).toBe(false),
      )
      await user.click(screen.getByTestId('organisation.settings.locale-select'))
      await user.click(await screen.findByRole('option', { name: 'Español' }))
      await waitFor(() =>
        expect(asked).toEqual([`acme ${organisationSettingsCommands.updateLocale.id}`]),
      )

      act(() => select('globex'))

      await act(async () => {
        change.done(undefined)
      })

      expect(asked).toEqual([`acme ${organisationSettingsCommands.updateLocale.id}`])
    })
  })

  describe('the invitation form', () => {
    it('empties once the invitation is sent', async () => {
      const sent = later<InvitationView>()
      const invite = vi.fn(() => sent.result)

      await openPage([acme], gatewayWith({ invite }))
      type('organisation.invite.email-input', 'bea@example.test')
      fireEvent.click(screen.getByTestId('organisation.invite.submit-button'))
      await waitFor(() =>
        expect(invite).toHaveBeenCalledWith('acme', 'bea@example.test', CONTRACT_ROLES.member),
      )

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
        expect(invite).toHaveBeenCalledWith('acme', 'late@example.test', CONTRACT_ROLES.member),
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

  describe('the new note form', () => {
    it('empties once the note is written', async () => {
      const written = later<void>()
      const execute = vi.fn(() => written.result)

      await openPage([acme], gatewayWith({}), noInvitations, { execute })
      type('organisation.notes.new-textarea', 'Plans')
      fireEvent.click(screen.getByTestId('organisation.notes.add-button'))
      await waitFor(() => expect(execute).toHaveBeenCalled())

      expect(field('organisation.notes.new-textarea').value).toBe('Plans')

      await act(async () => {
        written.done(undefined)
      })

      await waitFor(() => expect(field('organisation.notes.new-textarea').value).toBe(''))
    })

    it('keeps what was typed when the note is refused', async () => {
      const written = later<void>()

      await openPage([acme], gatewayWith({}), noInvitations, { execute: () => written.result })
      type('organisation.notes.new-textarea', 'Plans')
      fireEvent.click(screen.getByTestId('organisation.notes.add-button'))
      await act(async () => {
        written.refuse('failed')
      })

      await screen.findByTestId('organisation.notes.error')

      expect(field('organisation.notes.new-textarea').value).toBe('Plans')
    })
  })

  describe('the create form', () => {
    it('empties once the organisation is created, which is current by then', async () => {
      const created = later<Membership>()
      const create = vi.fn(() => created.result)

      await openPage([acme], gatewayWith({ create }))
      fireEvent.click(screen.getByTestId('organisation.create.toggle-button'))
      type('organisation.create.key-input', 'acme')
      type('organisation.create.name-input', 'Acme')
      fireEvent.click(screen.getByTestId('organisation.create.submit-button'))
      await waitFor(() => expect(create).toHaveBeenCalledWith({ key: 'acme', name: 'Acme' }))

      expect(field('organisation.create.key-input').value).toBe('acme')

      await act(async () => {
        created.done(acme)
      })

      await waitFor(() => expect(field('organisation.create.key-input').value).toBe(''))
      expect(field('organisation.create.name-input').value).toBe('')
    })

    it('keeps what was typed when the creation is refused', async () => {
      const created = later<Membership>()

      await openPage([acme], gatewayWith({ create: () => created.result }))
      fireEvent.click(screen.getByTestId('organisation.create.toggle-button'))
      type('organisation.create.key-input', 'acme')
      type('organisation.create.name-input', 'Acme')
      fireEvent.click(screen.getByTestId('organisation.create.submit-button'))
      await act(async () => {
        created.refuse('key-taken')
      })

      await screen.findByTestId('organisation.create.error')

      expect(field('organisation.create.key-input').value).toBe('acme')
      expect(field('organisation.create.name-input').value).toBe('Acme')
    })
  })

  describe("a member's role select", () => {
    it('shows the role being set only in the organisation the change runs in', async () => {
      const change = later<void>()
      const setRole = vi.fn(() => change.result)
      const members = vi.fn(() => okAsync([annAdmin, beaMember]))
      const { select } = await openPage([acme, globex], gatewayWith({ members, setRole }))

      await makeAdmin(beaMember)
      await waitFor(() =>
        expect(setRole).toHaveBeenCalledWith('acme', bea.id, CONTRACT_ROLES.admin),
      )

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.admin)

      // The membership in Acme goes away on another device, which makes Globex current here;
      // bea is a member there too, and nobody changed her role in it.
      act(() => select('globex'))
      await waitFor(() => expect(members).toHaveBeenCalledWith('globex'))

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.member)

      await act(async () => {
        change.done(undefined)
      })

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.member)
    })

    it('keeps the role just set until the members read after the change settle', async () => {
      const reread = later<readonly MemberView[]>()
      let reads = 0
      const members = vi.fn(() => (++reads === 1 ? okAsync([annAdmin, beaMember]) : reread.result))
      const setRole = vi.fn(() => okAsync(undefined))

      await openPage([acme], gatewayWith({ members, setRole }))

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.member)

      await makeAdmin(beaMember)
      await waitFor(() =>
        expect(setRole).toHaveBeenCalledWith('acme', bea.id, CONTRACT_ROLES.admin),
      )
      // The members are read again once the change is done; that read has not come yet.
      await waitFor(() => expect(members).toHaveBeenCalledTimes(2))

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.admin)

      await act(async () => {
        reread.done([annAdmin, { ...beaMember, role: CONTRACT_ROLES.admin }])
      })

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.admin)
    })

    it('shows what the members read after the change lists once it settled', async () => {
      const reread = later<readonly MemberView[]>()
      let reads = 0
      const members = vi.fn(() => (++reads === 1 ? okAsync([annAdmin, beaMember]) : reread.result))

      await openPage([acme], gatewayWith({ members }))
      await makeAdmin(beaMember)
      await waitFor(() => expect(members).toHaveBeenCalledTimes(2))

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.admin)

      // Another administrator put the member back meanwhile: the list is what the select shows.
      await act(async () => {
        reread.done([annAdmin, beaMember])
      })

      await waitFor(async () => expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.member))
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

      expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.admin)

      await act(async () => {
        change.refuse('not-admin')
      })

      await waitFor(async () => expect(await roleOf(beaMember)).toBe(CONTRACT_ROLES.member))
      expect(screen.getByTestId('organisation.invite.error').getAttribute('data-code')).toBe(
        'not-admin',
      )
    })
  })

  describe('the invitations for the account', () => {
    /** The invitations port of `ann` with `mine` read and `more` of it changed. */
    const invitationsWith = (more: Partial<InvitationsPort>): InvitationsPort => ({
      ...noInvitations,
      ...more,
    })

    it.each([
      ['accept', 'organisation.received.accept-button'],
      ['decline', 'organisation.received.decline-button'],
    ] as const)('keeps the list beside a failed %s and reads it again', async (answer, button) => {
      const mine = vi.fn(() => okAsync([fromInitech]))
      const refusal = later<never>()

      await openPage(
        [acme],
        gatewayWith({}),
        invitationsWith({ mine, [answer]: () => refusal.result }),
      )
      fireEvent.click(await screen.findByTestId(button))
      await act(async () => {
        refusal.refuse('other-account')
      })

      await waitFor(() => expect(mine).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('organisation.received.error').getAttribute('data-code')).toBe(
        'other-account',
      )
      expect(screen.getAllByTestId('organisation.received.item')).toHaveLength(1)
      expect(
        (screen.getByTestId(button) as HTMLButtonElement).disabled,
        'the invitation can be answered again',
      ).toBe(false)
    })

    it('shows a failed read in place of the list, even one read before it', async () => {
      const reread = later<readonly ReceivedInvitation[]>()
      let reads = 0
      const refusal = later<never>()

      await openPage(
        [acme],
        gatewayWith({}),
        invitationsWith({
          mine: () => (++reads === 1 ? okAsync([fromInitech]) : reread.result),
          decline: () => refusal.result,
        }),
      )
      fireEvent.click(await screen.findByTestId('organisation.received.decline-button'))
      await act(async () => {
        refusal.refuse('other-account')
      })
      await act(async () => {
        reread.refuse('offline')
      })

      await waitFor(() => expect(screen.queryByTestId('organisation.received.list')).toBeNull())
      const error = screen.getByTestId('organisation.received.error')

      expect(error.getAttribute('data-code'), 'the read failure, not the refusal').toBe('failed')
      expect(error.textContent).toBe(en['organisation.error.failed'])
    })

    it('lets an invitation gone meanwhile leave the list read after a failed answer', async () => {
      let reads = 0
      const refusal = later<never>()

      await openPage(
        [acme],
        gatewayWith({}),
        invitationsWith({
          mine: () => okAsync(++reads === 1 ? [fromInitech] : []),
          accept: () => refusal.result,
        }),
      )
      fireEvent.click(await screen.findByTestId('organisation.received.accept-button'))
      await act(async () => {
        refusal.refuse('invitation-gone')
      })

      await waitFor(() => expect(screen.queryByTestId('organisation.received.item')).toBeNull())
      expect(screen.getByTestId('organisation.received.error').getAttribute('data-code')).toBe(
        'invitation-gone',
      )
    })
  })
})
