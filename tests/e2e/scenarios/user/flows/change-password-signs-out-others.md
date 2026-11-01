---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  New password: generate
---
# Change the password while another device is signed in

Where: [/settings] on device A, and [/me] on device B, another browser

## Scenario: A changed password signs the account's other devices out and keeps this one signed in

### Steps
1. On device B, sign in with the same account and wait for [/me]
2. On device A, open [/settings], enter the account's password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]

### Expected result
- After step 2 [app-shell.toast] carries [code:password-changed] on device A, which stays on [/settings]
- Device B is signed out: its URL is [/sign-in] and [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
