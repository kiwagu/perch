import type { ProfileId } from '@workspace/ids'

export interface ProfileFields {
  readonly name: string
  readonly bio: string
}

/** What the page holds beside the machine: the profile as stored, and what was typed into it. */
export interface ProfileValues {
  readonly id: ProfileId | undefined
  readonly stored: ProfileFields
  readonly drafts: ProfileFields
}

export interface ProfileContext {
  /** The code of the last refused save, until a save succeeds. */
  readonly error: string | undefined
  /** The fields whose region is `edited`: they show what was typed, not the stored value. */
  readonly edited: { readonly [Field in keyof ProfileFields]: boolean }
}
