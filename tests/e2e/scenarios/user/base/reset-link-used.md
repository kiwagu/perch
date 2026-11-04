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
  Other password: generate
---
# Open a password reset link a second time

Where: [/reset-password] from [mail:request-password-reset], once its link has set a password

## Scenario: A reset link sets a password once; opened again it says the link does not work and leads to asking for a new one

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. Open the same link again, enter the other password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
5. Click [user.reset-password.forgot-link]

### Expected result
- After step 3 [user.reset-password.message] carries [code:password-reset]
- After step 4 [user.reset-password.error] carries [code:link-invalid] and [user.reset-password.forgot-link] shows
- After step 5 the URL is [/forgot-password]
