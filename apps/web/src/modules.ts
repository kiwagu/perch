import { DeviceModule } from './features/device/device.module'
import { NotFoundModule } from './features/not-found/not-found.module'
import { OrganisationModule } from './features/organisation/organisation.module'
import { UserModule } from './features/user/user.module'
import type { ModuleDef } from './platform/module'

/** The feature modules of the application, in navigation order; the page of an unknown address last. */
export const modules: readonly ModuleDef[] = [
  UserModule,
  OrganisationModule,
  DeviceModule,
  NotFoundModule,
]
