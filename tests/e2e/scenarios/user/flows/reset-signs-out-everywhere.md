---
tags:
  - full
devices:
  A: identity
  B: guest
data:
  New password: generate
---
# Set a new password while another device is signed in

Where: [/me] on device A, and [/forgot-password] then [/reset-password] on device B, another browser

## Scenario: A new password set from the mail signs every device of the account out

### Steps
1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]
2. On device B, open [/forgot-password], enter the account's email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]
3. On device B, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]

### Expected result
- After step 3 [user.reset-password.message] carries [code:password-reset] on device B
- Device A is signed out: its URL is [/sign-in] and [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
