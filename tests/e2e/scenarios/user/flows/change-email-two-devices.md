---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
  New email: generate
---
# Change the email while another device is signed in

Where: [/settings] on device A, and [/me] on device B, another browser

## Scenario: The new email reaches the account's other device, and the old email no longer signs in

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]
3. On device A, open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], click [user.settings.email.send-button], and open the link of [mail:change-email]
4. On device B, click [user.profile.sign-out-button], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]
5. On device B, enter the new email into [user.sign-in.email-input] and click [user.sign-in.submit-button]

### Expected result
- After step 3 [user.profile.email-input] on device B holds the new email
- After step 4 [user.sign-in.error] carries [code:invalid-credentials] on device B
- After step 5 [app-shell.notice-message] carries [code:welcome] on device B and its URL is [/me]
