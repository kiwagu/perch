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

## Scenario: An administrator invites an account, which then sees the organisation as a member, without its members or the invitation

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the unknown email into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, clear [organisation.invite.email-input], enter the email of user B into it and click [organisation.invite.submit-button]
5. On device B, open [/org]

### Expected result
- After step 3 device A shows [organisation.invite.error] carrying [code:no-such-identity], and [organisation.members.list] holds only user A's [organisation.members.item]
- After step 4 device A shows [app-shell.toast] carrying [code:invited] and user B's [organisation.members.item] in [organisation.members.list], with [organisation.members.remove-button]
- After step 5 device B shows the organisation name in [organisation.page.heading], [organisation.page.role-badge] carrying [value:member], [organisation.notes.section] in [state:empty] with [organisation.notes.new-textarea] and [organisation.notes.add-button], and [organisation.create.toggle-button]
- Device B shows no [organisation.members.list], no [organisation.invite.form] and no [organisation.page.status]
