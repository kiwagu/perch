---
tags:
  - full
devices:
  A: admin
  B: admin
data:
  Organisation key: generate
  Organisation name: generate
---
# Invite the same email again

Where: [/org] on device A (user A, administrator) and [/invitation] from [mail:organisations.invite] on device B (user B, another browser)

## Scenario: A second invitation of an email replaces the first: the first link no longer works, and the second makes the account an administrator

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, set [organisation.invite.role-select] to [value:admin], enter the email of user B into [organisation.invite.email-input] again and click [organisation.invite.submit-button]
5. On device B, open the link of the first [mail:organisations.invite]
6. On device B, open the link of the second [mail:organisations.invite] and click [organisation.invitation.accept-button]

### Expected result
- After step 4 device A's [organisation.sent.list] holds one [organisation.sent.item], user B's, whose [organisation.sent.role-badge] carries [value:admin], and [organisation.invite.role-select] shows [value:member] again
- After step 5 [organisation.invitation.error] carries [code:link-invalid] on device B
- After step 6 [organisation.page.role-badge] carries [value:admin] on device B, and [organisation.members.list] shows
