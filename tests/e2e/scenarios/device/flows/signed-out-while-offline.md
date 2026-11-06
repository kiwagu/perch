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
# Sign a device out while it is offline

Where: [/devices] on device A, and [/me] on device B, another browser

## Scenario: A device signed out from another one while it was offline learns why when it connects again

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and open [/devices]
2. On device B, sign in with the same account and wait for [/me]
3. Take device B's browser offline
4. On device A, reload [/devices], click [device.list.revoke-button] on device B's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]
5. Bring device B's browser back online

### Expected result
- After step 4 device B's [device.list.session-item] on device A is in [state:revoked], and device B is still on [/me]
- Within 5 seconds of step 5 device B is on [/sign-in], where [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
