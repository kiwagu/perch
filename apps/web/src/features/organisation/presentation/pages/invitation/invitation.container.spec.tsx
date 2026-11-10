// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { replicaSchema } from '@workspace/database/replica-schema'
import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import {
  gatewayWith,
  later,
  membership,
  noInvitations,
  sessionIn,
} from '../../../../../platform/__fixtures__/organisations'
import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import type { InvitationOnLink, InvitationsPort } from '../../../../../platform/invitations.port'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'
import {
  ORGANISATION_SERVICE,
  OrganisationService,
} from '../../../application/organisation.service'

import { InvitationContainer } from './invitation.container'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }

const forAnn: InvitationOnLink = { organisation: { name: 'Acme' }, role: 'admin', forYou: true }
const acme = membership('acme', 'Acme', 'admin')

const ACCEPT = 'organisation.invitation.accept-button'
const DECLINE = 'organisation.invitation.decline-button'
const ERROR = 'organisation.invitation.error'

/** An answer of the gateway that refuses with `code`, as its routes do. */
const refused = (code: string) => () => {
  const answer = later<never>()

  answer.refuse(code)

  return answer.result
}

interface Opening {
  /** Whether Ann is signed in on the device. */
  readonly signedIn?: boolean
  readonly read?: InvitationsPort['read']
  readonly accept?: InvitationsPort['accept']
  readonly decline?: InvitationsPort['decline']
}

/** The page at `at`, over a gateway whose invitations answer as `opening` says. */
function open(at: string, opening: Opening = {}) {
  const {
    signedIn = true,
    read = () => okAsync(forAnn),
    accept = () => okAsync(acme),
    decline = () => okAsync(undefined),
  } = opening
  const port = {
    ...noInvitations,
    read: vi.fn(read),
    accept: vi.fn(accept),
    decline: vi.fn(decline),
  } satisfies InvitationsPort
  const session: SessionPort = signedIn ? sessionIn(ann, []).session : fakeSession().session
  const selectTenant = vi.spyOn(session, 'selectTenant')
  const services = fakeServices(session)

  services.container.singleton(
    ORGANISATION_SERVICE,
    () => new OrganisationService(session, gatewayWith({}), port, replicaSchema),
  )

  const TestModule = defineModule({
    id: 'test',
    declarations: { Invitation: InvitationContainer, Organisation: () => <p>the organisation</p> },
    routes: [
      {
        path: '/invitation',
        page: 'Invitation',
        search: z.object({ token: z.string().min(1).max(4096).optional() }),
      },
      { path: '/org', page: 'Organisation' },
    ],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )

  return { port, router, selectTenant }
}

const press = (testId: string) =>
  act(async () => fireEvent.click(await screen.findByTestId(testId)))

describe('InvitationContainer', () => {
  it("reads the address's token and offers the account it is for the buttons", async () => {
    const { port } = open('/invitation?token=the-token')

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Acme')
    expect(
      screen.getByTestId('organisation.invitation.role-badge').getAttribute('data-value'),
    ).toBe('admin')
    expect(port.read).toHaveBeenCalledWith('the-token')
    expect((screen.getByTestId(ACCEPT) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId(DECLINE) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId('organisation.invitation.status')).toBeNull()
    expect(document.body.textContent).not.toContain('@')
  })

  it('shows the status while the link is checked', async () => {
    open('/invitation?token=the-token', { read: () => later<InvitationOnLink>().result })

    expect(
      (await screen.findByTestId('organisation.invitation.status')).getAttribute('data-state'),
    ).toBe('loading')
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
  })

  it("accepts with the address's token and moves to the organisation page", async () => {
    const { port, router, selectTenant } = open('/invitation?token=the-token')

    await press(ACCEPT)

    await waitFor(() => expect(router.state.location.pathname).toBe('/org'))
    expect(port.accept).toHaveBeenCalledTimes(1)
    expect(port.accept).toHaveBeenCalledWith('the-token')
    expect(selectTenant).toHaveBeenCalledWith('acme')
    expect(port.decline).not.toHaveBeenCalled()
    expect(await screen.findByText('the organisation')).toBeTruthy()
  })

  it("declines with the address's token and moves to the organisation page", async () => {
    const { port, router } = open('/invitation?token=the-token')

    await press(DECLINE)

    await waitFor(() => expect(router.state.location.pathname).toBe('/org'))
    expect(port.decline).toHaveBeenCalledWith('the-token')
    expect(port.accept).not.toHaveBeenCalled()
  })

  it('says why a press did not join, and keeps the buttons for another', async () => {
    const { router } = open('/invitation?token=the-token', { accept: refused('already-member') })

    await press(ACCEPT)

    await waitFor(() =>
      expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe('already-member'),
    )
    expect((screen.getByTestId(ACCEPT) as HTMLButtonElement).disabled).toBe(false)
    expect(router.state.location.pathname).toBe('/invitation')
  })

  it('ends on a link that does not work when the invitation is gone meanwhile', async () => {
    open('/invitation?token=the-token', { decline: refused('invitation-gone') })

    await press(DECLINE)

    await waitFor(() =>
      expect(screen.getByTestId(ERROR).getAttribute('data-code')).toBe('invitation-gone'),
    )
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
    expect(screen.queryByTestId(DECLINE)).toBeNull()
  })

  it('tells a guest to sign in to the account, with the link to the sign-in page', async () => {
    open('/invitation?token=the-token', {
      signedIn: false,
      read: () => okAsync({ ...forAnn, forYou: false }),
    })

    expect(
      (await screen.findByTestId('organisation.invitation.message')).getAttribute('data-code'),
    ).toBe('sign-in-to-accept')
    expect(screen.getByTestId('organisation.invitation.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme')
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
  })

  it('tells another account signed in that the invitation is not for it, offering nothing', async () => {
    open('/invitation?token=the-token', { read: () => okAsync({ ...forAnn, forYou: false }) })

    expect((await screen.findByTestId(ERROR)).getAttribute('data-code')).toBe('other-account')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acme')
    expect(screen.queryByTestId(ACCEPT)).toBeNull()
    expect(screen.queryByTestId('organisation.invitation.sign-in-link')).toBeNull()
  })

  it.each(['link-invalid', 'link-expired', 'rate-limited'])(
    'shows the refusal of the read: %s',
    async (code) => {
      open('/invitation?token=the-token', { read: refused(code) })

      expect((await screen.findByTestId(ERROR)).getAttribute('data-code')).toBe(code)
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.queryByTestId(ACCEPT)).toBeNull()
    },
  )

  it('shows a link without a token as one that does not work, asking the gateway nothing', async () => {
    const { port } = open('/invitation')

    expect((await screen.findByTestId(ERROR)).getAttribute('data-code')).toBe('link-invalid')
    expect(port.read).not.toHaveBeenCalled()
  })

  it('starts afresh when the address names another token', async () => {
    const { port, router } = open('/invitation?token=first')

    await screen.findByTestId(ACCEPT)
    await act(async () => router.navigate({ to: '/invitation', search: { token: 'second' } }))

    await waitFor(() => expect(port.read).toHaveBeenCalledWith('second'))
    expect(port.read).toHaveBeenCalledTimes(2)
  })
})
