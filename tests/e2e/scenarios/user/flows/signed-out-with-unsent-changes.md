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
  Unsent name: generate
---
# Sign a device out from another one while it holds changes not sent yet

Where: [/me] on device A, and [/devices] then [/me] on device B, another browser

## Scenario: A device signed out from another one keeps the changes it had not sent, and signing in again as the same account sends them

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device B, sign in with the same account and open [/devices]
3. Take device A's browser offline, enter the unsent name into [user.profile.name-input] and click [user.profile.save-button]
4. On device B, click [device.list.revoke-button] on device A's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, open [/me]
6. Bring device A's browser back online
7. On device A, sign in again with the same account and wait for [/me]

### Expected result
- After step 3 device A shows [app-shell.toast] carrying [code:profile-saved] and the unsent name, and its sync channel is down
- After step 4 device A's [device.list.session-item] on device B is in [state:revoked]
- After step 5 device B shows the name, not the unsent name: the change has not reached the server
- After step 6 device A is on [/sign-in], where [user.sign-in.notice-message] carries [code:resend-after-sign-in], and its browser keeps the local database of the account
- After step 7 device A shows the unsent name, and within 5 seconds device B shows it too: signing in again sent the change device A kept
