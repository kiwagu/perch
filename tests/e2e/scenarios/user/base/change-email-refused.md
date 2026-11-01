---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  Other email: generate
  Other password: generate
  Wrong password: generate
---
# Ask to change the email with a wrong password, and to an email that has an account

Where: [/settings], the form [user.settings.email.form]

## Scenario: A wrong password is refused under it; a new email that has an account gets the same answer as a free one, and no mail

### Steps
1. Sign up with the other email, the other password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
3. Enter the other email into [user.settings.email.email-input] and the wrong password into [user.settings.email.password-input], and click [user.settings.email.send-button]
4. Enter the password into [user.settings.email.password-input] and click [user.settings.email.send-button]

### Expected result
- After step 3 [user.settings.email.error] carries [code:invalid-credentials] under [user.settings.email.password-input]
- After step 4 [user.settings.email.message] carries [code:check-your-mail], and no [mail:change-email] reaches the other email
