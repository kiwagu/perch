---
tags:
  - full
devices:
  A: admin
  B: identity
  C: guest
data:
  Organisation key: generate
  Organisation name: generate
  Invited email: generate
---
# Open an invitation's link elsewhere than in the invited account

Where: [/org] on device A (user A, administrator), then [/invitation] from [mail:organisations.invite] on device B (user B, signed in, another browser) and on device C (nobody signed in, a third browser)

## Scenario: Another account sees the organisation and the role with an error and nothing to press; a guest is asked to sign in to the invited account, with the link to the sign-in page

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the invited email into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device B, open the link of the [mail:organisations.invite] that reached the invited email
5. On device C, open the same link
6. On device C, click [organisation.invitation.sign-in-link]

### Expected result
- After step 4 device B shows the organisation name in [organisation.invitation.heading], [organisation.invitation.role-badge] carrying [value:member] and [organisation.invitation.error] carrying [code:other-account], and neither [organisation.invitation.accept-button] nor [organisation.invitation.decline-button]
- After step 5 device C shows the organisation name in [organisation.invitation.heading], [organisation.invitation.message] carrying [code:sign-in-to-accept] and [organisation.invitation.sign-in-link], and neither [organisation.invitation.accept-button] nor [organisation.invitation.decline-button]
- After step 6 the URL is [/sign-in] on device C
