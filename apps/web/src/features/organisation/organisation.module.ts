import { SHAPE_RUNNER } from '@workspace/data'
import { replicaSchema } from '@workspace/database/replica-schema'

import { COMMANDS } from '../../platform/commands.port'
import { defineModule } from '../../platform/module'
import { ORGANISATIONS } from '../../platform/organisations.port'
import { SESSION } from '../../platform/session.port'

import { NOTES_SERVICE, NotesService } from './application/notes.service'
import { ORGANISATION_SERVICE, OrganisationService } from './application/organisation.service'
import { OrganisationContainer } from './presentation/pages/organisation/organisation.container'
import {
  organisationCommands,
  organisationShape,
} from './presentation/pages/organisation/organisation.model.gen'

/**
 * Organisations of the signed-in identity: creating one, its members for an administrator, and
 * the notes every member of the current organisation shares.
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
          replicaSchema,
        ),
    },
  ],
  declarations: { OrganisationPage: OrganisationContainer },
  routes: [{ path: '/org', page: 'OrganisationPage', guard: 'authenticated' }],
})
