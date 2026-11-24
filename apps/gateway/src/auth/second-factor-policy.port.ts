import type { IdentityId } from '@workspace/ids'

/** What a policy decides about one account's second factor. */
export interface SecondFactorDecision {
  /** Whether the account may turn its second factor on. */
  readonly allowed: boolean
  /** Whether the account must keep its second factor on: it may not turn it off. */
  readonly required: boolean
}

/**
 * Who decides whether an account may, or must, have a second factor. The settings ask it before
 * they turn the factor on (`allowed`) and before they turn it off (`required`); today the account
 * itself chooses (`accountChoicePolicy`), and a later policy, such as an organisation's, can
 * require the factor of its members without a change to the settings.
 */
export interface SecondFactorPolicy {
  decide(identity: IdentityId): Promise<SecondFactorDecision>
}
