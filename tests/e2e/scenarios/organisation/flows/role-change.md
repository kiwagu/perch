---
tags:
  - full
devices:
  A: member
  B: admin
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
---
# Promote and demote a member

Where: [/org] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: A promoted member becomes an administrator on its device without a reload, and its next change is judged by the new role; the new administrator demotes the first, and the last administrator cannot demote itself

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button], enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]
5. On device A, reload [/org] and, on user B's [organisation.members.item], set [organisation.members.role-select] to [value:admin]
6. On device B, click [organisation.notes.delete-button] on the note by A and confirm with [app-shell.confirmation.confirm-button]
7. On device B, on user A's [organisation.members.item], set [organisation.members.role-select] to [value:member]
8. On device B, on its own [organisation.members.item], set [organisation.members.role-select] to [value:member]

### Expected result
- After step 4 device B shows the note by A without [organisation.notes.delete-button], and no [organisation.members.list]
- After step 5 [app-shell.toast] carries [code:role-changed] on device A
- Within 5 seconds of step 5 device B shows [organisation.page.role-badge] carrying [value:admin], [organisation.members.list] with both members and [organisation.notes.delete-button] on the note by A, without a reload; the delay is reported as "role-change-ms"
- Within 5 seconds of step 6 device A no longer shows the note by A, without a reload
- Within 5 seconds of step 7 device A shows [organisation.page.role-badge] carrying [value:member], and no [organisation.members.list] and no [organisation.invite.form], without a reload
- After step 8 [organisation.invite.error] carries [code:last-admin] on device B, and its own [organisation.members.item] has [organisation.members.role-select] showing [value:admin]
- Device B loaded no page since step 4
