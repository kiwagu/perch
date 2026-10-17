import { OrganisationModule } from './features/organisation/organisation.module'
import { UserModule } from './features/user/user.module'
import type { ModuleDef } from './platform/module'

/** The feature modules of the application, in navigation order. */
export const modules: readonly ModuleDef[] = [UserModule, OrganisationModule]
