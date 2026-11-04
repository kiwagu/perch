---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Open an account deletion link a second time

Where: [/delete-account] from [mail:request-account-deletion], once its button has deleted the account

## Scenario: A deletion link deletes once; opened again it says the link does not work, and offers no button

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]
3. Open the link of [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]
4. Open the same link again, click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]

### Expected result
- After step 3 [user.delete-account.message] carries [code:account-deleted]
- After step 4 [user.delete-account.error] carries [code:link-invalid] and no [user.delete-account.delete-button] shows
