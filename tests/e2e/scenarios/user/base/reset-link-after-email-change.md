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
  New password: generate
---
# Open a reset link after the email changed

Where: [/forgot-password], then [/settings] and [/confirm-email] from [mail:change-email], then [/reset-password] from [mail:request-password-reset]

## Scenario: A reset link mailed to the old email stops working once the new email is confirmed

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. Open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]
4. Open the link of [mail:change-email]
5. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]

### Expected result
- After step 2 [mail:request-password-reset] reaches the email
- After step 4 [user.confirm-email.message] carries [code:email-changed]
- After step 5 [user.reset-password.error] carries [code:link-invalid] and [user.reset-password.forgot-link] shows
