---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  Wrong password: generate
---
# Ask to delete the account with a wrong password

Where: [/settings], the form [user.settings.deletion.form]

## Scenario: A wrong password is refused under it and sends no mail; the right one sends the mail

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the wrong password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]
3. Clear [user.settings.deletion.password-input], enter the password into it and click [user.settings.deletion.send-button]

### Expected result
- After step 2 [user.settings.deletion.error] carries [code:invalid-credentials] under [user.settings.deletion.password-input], and no [mail:request-account-deletion] reaches the email
- After step 3 [user.settings.deletion.message] carries [code:check-your-mail] and [mail:request-account-deletion] reaches the email
