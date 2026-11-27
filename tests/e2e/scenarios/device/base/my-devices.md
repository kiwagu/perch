---
tags:
  - full
activity: session
devices:
  A: identity
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign a device out from another one, and everywhere

Where: [screen:device] on device A, and [screen:user.profile] on device B, another browser

## Scenario: A device signed out from another one leaves at once, signing out everywhere signs every device out, and the account signs in again after it

### Steps
1. On device A, sign up, open the link of [mail:sign-up] and open [screen:device]
2. On device B, sign in with the same account and wait for [screen:user.profile]
3. On device A, reload [screen:device]
4. On device A, click [device.list.revoke-button] on device B's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, sign in again with the same account and wait for [screen:user.profile]
6. On device A, click [device.everywhere.open-button] and confirm with [device.everywhere.dialog.confirm-button]
7. On device A, sign in again with the same account and wait for [screen:user.profile]

### Expected result
- After step 1 device A's [device.list] holds one [device.list.session-item], in [state:current] (this device)
- After step 3 device A's [device.list] holds two [device.list.session-item]: device B's is not in [state:current] and its [device.list.seen-cell] is within the last minute
- Within 5 seconds of step 4 device B is on [screen:user.sign-in], where [user.sign-in.notice-message] carries [code:signed-out-elsewhere], and its browser keeps no local database of the account; on device A, device B's [device.list.session-item] is in [state:revoked]
- After step 6 device A is on [screen:user.sign-in], where [user.sign-in.notice-message] carries [code:signed-out-elsewhere]; within 5 seconds device B is on [screen:user.sign-in] with the same notice; a reload of either stays on [screen:user.sign-in]
- After step 7 device A is on [screen:user.profile] and its sync channel is up: the account signs in again after signing out everywhere
