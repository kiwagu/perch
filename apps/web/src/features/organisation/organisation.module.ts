import { SHAPE_RUNNER } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'
import { z } from '@workspace/zod'

import { COMMANDS } from '../../platform/commands.port'
import { INVITATIONS } from '../../platform/invitations.port'
import { defineModule } from '../../platform/module'
import { ORGANISATIONS } from '../../platform/organisations.port'
import { SESSION } from '../../platform/session.port'

import { NOTES_SERVICE, NotesService } from './application/notes.service'
import { ORGANISATION_SERVICE, OrganisationService } from './application/organisation.service'
import { InvitationContainer } from './presentation/pages/invitation/invitation.container'
import { OrganisationContainer } from './presentation/pages/organisation/organisation.container'
import {
  organisationCommands,
  organisationShape,
} from './presentation/pages/organisation/organisation.model.gen'

/**
 * Organisations of the signed-in identity: creating one, its members for an administrator, the
 * notes every member of the current organisation shares, and the page the link of an invitation
 * mail opens.
 */
export const OrganisationModule = defineModule({
  id: 'organisation',
  providers: [
    {
      provide: NOTES_SERVICE,
      useFactory: (container) =>
        new NotesService(
          container.get(SHAPE_RUNNER),
          container.get(COMMANDS),
          { shape: organisationShape, commands: organisationCommands },
          () => container.get(ORGANISATION_SERVICE).ability(),
        ),
    },
    {
      provide: ORGANISATION_SERVICE,
      useFactory: (container) =>
        new OrganisationService(
          container.get(SESSION),
          container.get(ORGANISATIONS),
          container.get(INVITATIONS),
          replicaSchema,
        ),
    },
  ],
  declarations: { OrganisationPage: OrganisationContainer, InvitationPage: InvitationContainer },
  routes: [
    {
      path: '/org',
      page: 'OrganisationPage',
      guard: 'authenticated',
      roles: ['identity', 'member', 'admin'],
    },
    // Open to anyone: the link says what it offers, and a guest is asked to sign in first.
    {
      path: '/invitation',
      page: 'InvitationPage',
      roles: ['guest', 'identity'],
      search: z.object({ token: z.string().min(1).max(4096).optional() }),
    },
  ],
})
