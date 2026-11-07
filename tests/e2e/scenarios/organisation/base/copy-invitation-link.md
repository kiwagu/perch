---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
---
# Copy an invitation's link

Where: [/org] on device A (user A, administrator) and [/invitation] from the copied link on device B (user B, another browser)

## Scenario: The copied link is the link the invitation mail carries, and it lets the invited account join

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, click [organisation.sent.copy-button] on user B's [organisation.sent.item]
5. On device B, open the link copied on device A and click [organisation.invitation.accept-button]

### Expected result
- After step 4 [app-shell.toast] carries [code:link-copied] on device A, and the clipboard holds the link of the [mail:organisations.invite] that reached user B's email
- After step 5 the URL is [/org] on device B, [app-shell.toast] carries [code:invitation-accepted] and [organisation.page.role-badge] carries [value:member]
