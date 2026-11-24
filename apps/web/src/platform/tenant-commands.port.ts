import { token } from '@workspace/di'

import type { CommandsPort } from './commands.port'

/**
 * Runs declared commands into the tenant region of one organisation, named by its key, whichever
 * organisation is current when the write is admitted: validated, logged and written as the
 * current-organisation commands are, and refused once that organisation's database is not open or
 * `admitted` no longer holds when the write is admitted.
 */
export interface TenantCommandsPort {
  forTenant(key: string, admitted?: () => boolean): CommandsPort
}

export const TENANT_COMMANDS = token<TenantCommandsPort>('TenantCommands')
