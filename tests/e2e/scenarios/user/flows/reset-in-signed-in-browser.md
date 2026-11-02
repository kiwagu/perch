---
tags:
  - full
devices:
  A: identity
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Set a new password from a browser that is still signed in

Where: [/forgot-password] then [/reset-password] on a device signed in to the account

## Scenario: A device still signed in to the account can set a new password from the mail; it is signed out by it and signs in again with the new password

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]
4. Click [user.reset-password.sign-in-link], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]

### Expected result
- After step 3 [user.reset-password.message] carries [code:password-reset], and the device is signed out: [app-shell.nav] no longer shows
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
