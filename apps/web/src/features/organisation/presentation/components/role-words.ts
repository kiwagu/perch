import type { Translate } from '@workspace/i18n'
import { CONTRACT_ROLES } from '@workspace/kernel'

import type { TenantRole } from '../../application/organisation-machine'

/** The words of a role, as a badge or an option shows it. */
export function roleLabel(t: Translate, role: TenantRole): string {
  return t(role === CONTRACT_ROLES.admin ? 'organisation.role.admin' : 'organisation.role.member')
}

/** The choices of a role select: a plain member first. */
export function roleOptions(
  t: Translate,
): readonly { readonly value: TenantRole; readonly label: string }[] {
  return [
    { value: CONTRACT_ROLES.member, label: t('organisation.role.member') },
    { value: CONTRACT_ROLES.admin, label: t('organisation.role.admin') },
  ]
}
