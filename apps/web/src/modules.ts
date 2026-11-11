import { ConsoleModule } from './features/console/console.module'
import { DeviceModule } from './features/device/device.module'
import { NotFoundModule } from './features/not-found/not-found.module'
import { OrganisationModule } from './features/organisation/organisation.module'
import { UserModule } from './features/user/user.module'
import type { ModuleDef } from './platform/module'

/**
 * The feature modules of the application, in navigation order; last the not-found page, which an
 * unknown address opens and a page shows in its place for a device without the page's roles.
 */
export const modules: readonly ModuleDef[] = [
  UserModule,
  OrganisationModule,
  DeviceModule,
  ConsoleModule,
  NotFoundModule,
]
