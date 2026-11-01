---
tags:
  - full
devices:
  A: identity
  B: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Change the password while another device is signed in

Where: [/settings] on device A, and [/me] on device B, another browser

## Scenario: A changed password signs the account's other devices out and keeps this one signed in

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]
3. On device A, open [/settings], enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]

### Expected result
- After step 3 [app-shell.toast] carries [code:password-changed] on device A, which stays on [/settings]
- Device B is signed out: its URL is [/sign-in] and [user.sign-in.notice-message] carries [code:password-changed-elsewhere]
