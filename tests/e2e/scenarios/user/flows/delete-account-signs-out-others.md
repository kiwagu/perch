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
---
# Delete the account while another device is signed in

Where: [screen:user.settings] on device A, then [screen:user.delete-account] from [mail:request-account-deletion]; [screen:user.profile] on device B, another browser

## Scenario: The deletion signs the account's other devices out, and the device that deleted keeps the page's message

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [screen:user.profile]
2. On device B, open [screen:user.sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [screen:user.profile]
3. On device A, open [screen:user.settings], enter the password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]

### Expected result
- After step 3 [user.delete-account.message] carries [code:account-deleted] on device A, which stays on [screen:user.delete-account] and shows [user.delete-account.sign-in-link]
- Device B is signed out: its URL is [screen:user.sign-in] and [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
