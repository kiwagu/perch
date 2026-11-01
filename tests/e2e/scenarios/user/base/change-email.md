---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New email: generate
---
# Change the email in the settings

Where: [/settings], the form [user.settings.email.form], then [/confirm-email] from [mail:change-email]

## Scenario: The email changes once the link of the mail sent to the new email is opened; the old address is told, and the account signs in with the new email

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]
3. Open the link of [mail:change-email]
4. Click [user.confirm-email.profile-link]
5. Click [user.profile.sign-out-button], enter the new email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.settings.email.message] carries [code:check-your-mail], and [mail:change-email] reaches the new email
- After step 3 the link opens [/confirm-email], [user.confirm-email.message] carries [code:email-changed], and [notice:confirm-email.email-changed] reaches the email, naming neither the new email nor any part of it
- After step 4 the URL is [/me] and [user.profile.email-input] holds the new email
- After step 5 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
