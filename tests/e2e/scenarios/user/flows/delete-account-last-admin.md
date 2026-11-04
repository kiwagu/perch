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
# Delete an account that administers an organisation with other members

Where: [/settings] on device A (user A, administrator) and [/org] on device B (user B, another browser)

## Scenario: The deletion is refused while other members are in; once they are removed, the account goes with its organisation, and the key is free

### Steps
1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]
2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, invite user B with [organisation.invite.email-input] and [organisation.invite.submit-button]
4. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]
5. On device A, open [/org], click [organisation.members.remove-button] on user B's [organisation.members.item] and confirm with [app-shell.confirmation.confirm-button]
6. On device A, open [/settings], enter user A's password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of its [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]
7. On device B, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]

### Expected result
- After step 4 [user.settings.deletion.error] carries [code:last-admin] on device A, [user.settings.deletion.password-input] is empty, and no [mail:request-account-deletion] reaches user A's email
- After step 6 [user.delete-account.message] carries [code:account-deleted] on device A
- After step 7 [app-shell.toast] carries [code:organisation-created] on device B and [organisation.page.heading] shows the organisation name: the key was freed with user A's organisation
