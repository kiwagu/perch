---
tags:
  - smoke
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
  Unknown email: generate
---
# Open the organisation page as a member

Where: [/org] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: An administrator invites an unknown email and an account alike; the account accepts on its organisation page and sees the organisation as a member, without its members or the invitations

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the unknown email into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
5. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]

### Expected result
- After step 3 device A shows [app-shell.toast] carrying [code:invited] and the unknown email in [organisation.sent.list], and [organisation.members.list] holds only user A's [organisation.members.item]
- After step 4 [organisation.sent.list] holds both emails, each [organisation.sent.item] with [organisation.sent.copy-button] and [organisation.sent.revoke-button], and [organisation.members.list] still holds only user A's [organisation.members.item]
- After step 5 device B shows the organisation name in [organisation.page.heading], [organisation.page.role-badge] carrying [value:member], [organisation.notes.section] in [state:empty] with [organisation.notes.new-textarea] and [organisation.notes.add-button], and [organisation.create.toggle-button]
- Device B shows no [organisation.members.list], no [organisation.invite.form], no [organisation.sent.list] and no [organisation.page.status]
