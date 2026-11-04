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
# Delete an account that is a member of another account's organisation

Where: [/settings] on device A (user A, member) and [/org] on device B (user B, administrator, another browser)

## Scenario: The deleted account leaves the organisation, and the note it wrote stays

### Steps
1. On device A, sign up as user A, open the link of its [mail:sign-up] and wait for [/me]
2. On device B, sign up as user B, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input], click [organisation.create.submit-button], and invite user A with [organisation.invite.email-input] and [organisation.invite.submit-button]
3. On device A, open [/org], wait for [organisation.page.heading] to show the organisation name, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
4. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, reload [/org] and wait for [organisation.notes.section] to reach [state:ready]

### Expected result
- Within 5 seconds of step 3 [organisation.notes.list] on device B holds the note by A
- After step 4 [user.delete-account.message] carries [code:account-deleted] on device A
- After step 5 [organisation.members.list] on device B holds only user B's [organisation.members.item], and [organisation.notes.list] still holds the note by A
