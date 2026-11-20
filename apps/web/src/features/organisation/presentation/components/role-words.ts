import type { Translate } from '@workspace/i18n'

import type { TenantRole } from '../../application/organisation-machine'

/** The words of a role, as a badge or an option shows it. */
export function roleLabel(t: Translate, role: TenantRole): string {
  return t(role === 'admin' ? 'organisation.role.admin' : 'organisation.role.member')
}

/** The choices of a role select: a plain member first. */
export function roleOptions(
  t: Translate,
): readonly { readonly value: TenantRole; readonly label: string }[] {
  return [
    { value: 'member', label: t('organisation.role.member') },
    { value: 'admin', label: t('organisation.role.admin') },
  ]
}
