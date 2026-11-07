---
tags:
  - full
devices:
  A: guest
  B: admin
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
---
# Hand an organisation over, then delete the account

Where: [/org] and [/settings] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: The only administrator makes a member an administrator, then deletes its account; the organisation stays with the new administrator and keeps the note the deleted account wrote

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button], enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]
5. On device A, reload [/org] and, on user B's [organisation.members.item], set [organisation.members.role-select] to [value:admin]
6. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]
7. On device B, reload [/org] and wait for [organisation.notes.section] to reach [state:ready]

### Expected result
- After step 6 [user.delete-account.message] carries [code:account-deleted] on device A
- After step 7 device B shows [organisation.page.role-badge] carrying [value:admin], [organisation.members.list] holding only user B's [organisation.members.item], and the note by A in [organisation.notes.list]
