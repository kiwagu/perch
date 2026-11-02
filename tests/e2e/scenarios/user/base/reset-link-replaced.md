---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Ask for the reset mail twice

Where: [/forgot-password] twice, then [/reset-password] from each [mail:request-password-reset]

## Scenario: Only the newest reset link works: an earlier one says it does not

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button] twice
3. Open the link of the first [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. Open the link of the second [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]

### Expected result
- After step 3 [user.reset-password.error] carries [code:link-invalid] and [user.reset-password.forgot-link] shows
- After step 4 [user.reset-password.message] carries [code:password-reset]
