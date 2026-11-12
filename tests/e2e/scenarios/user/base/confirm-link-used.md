---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New email: generate
---
# Open an email confirmation link a second time

Where: [/confirm-email] from [mail:change-email], once its link has changed the email

## Scenario: A confirmation link changes the email once; opened again it says it does not work

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]
3. Open the link of [mail:change-email]
4. Open the same link again

### Expected result
- After step 3 [user.confirm-email.message] carries [code:email-changed]
- After step 4 [user.confirm-email.error] carries [code:link-invalid]
