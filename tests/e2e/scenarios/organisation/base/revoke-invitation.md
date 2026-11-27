---
tags:
  - full
devices:
  A: admin
  B: identity
data:
  Organisation key: generate
  Organisation name: generate
---
# Revoke an invitation

Where: [screen:organisation] on device A (user A, admin) and [screen:organisation.invitation] from [mail:organisations.invite], then [screen:organisation], on device B (user B, another browser)

## Scenario: An admin revokes a pending invitation once the frame has asked; its link then no longer works, and the invited account has no invitation

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [screen:user.profile]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [screen:organisation], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, click [organisation.sent.revoke-button] on user B's [organisation.sent.item] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, open the link of [mail:organisations.invite]
6. On device B, open [screen:organisation]

### Expected result
- At step 4 [app-shell.confirmation] carries [code:organisations-revoke-invitation]; after it [app-shell.toast] carries [code:invitation-revoked] on device A and no [organisation.sent.list] shows
- After step 5 [organisation.invitation.error] carries [code:link-invalid] on device B
- After step 6 device B shows [organisation.page.status] in [state:empty] and no [organisation.received.list]
