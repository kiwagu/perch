import type { SecondFactorPolicy } from './second-factor-policy.port'

/**
 * The policy of today: each account chooses for itself. Its second factor is always allowed and
 * never required, so an account turns it on and off as it likes.
 */
export const accountChoicePolicy: SecondFactorPolicy = {
  decide: () => Promise.resolve({ allowed: true, required: false }),
}
