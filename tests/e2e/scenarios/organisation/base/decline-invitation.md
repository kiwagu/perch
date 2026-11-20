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
# Decline an invitation on the organisation page

Where: [/org] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: The invited account declines on its organisation page; the invitation leaves its list and the administrator's, and its link no longer works

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device B, open [/org] and click [organisation.received.decline-button] on the organisation's [organisation.received.item]
5. On device A, reload [/org]
6. On device B, open the link of [mail:organisations.invite]

### Expected result
- After step 4 [app-shell.toast] carries [code:invitation-declined] on device B, no [organisation.received.list] shows, and [organisation.page.status] stays in [state:empty]
- After step 5 device A shows no [organisation.sent.list], and [organisation.members.list] holds only user A's [organisation.members.item]
- After step 6 [organisation.invitation.error] carries [code:link-invalid] on device B
