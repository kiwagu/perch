/**
 * The fields whose typed value the app stores: they show the saved state once what was typed is
 * stored. These are the anchors the contract binds to a model field (kind input, textarea or
 * select, holding input); `stored-fields-contract.spec.ts` holds the list to the contract.
 */

export const STORED_FIELDS: ReadonlySet<string> = new Set([
  'organisation.notes.edit-textarea',
  'organisation.notes.new-textarea',
  'user.profile.bio-textarea',
  'user.profile.email-input',
  'user.profile.name-input',
])

export const storesValue = (anchor: string): boolean => STORED_FIELDS.has(anchor)
