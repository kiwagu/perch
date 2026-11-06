---
tags:
  - full
devices:
  A: identity
  B: identity
  C: guest
  D: identity
  E: identity
  F: identity
  G: identity
  H: identity
  I: identity
  J: identity
  K: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Confirm a sign-in past the device limit once a place freed

Where: [/sign-in] on device B, and [/devices] on device A, with devices C to K, each another browser

## Scenario: A sign-in confirmed after one of the account's devices was signed out meanwhile signs no other device out

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On devices C to K in turn, sign in with the same account and wait for [/me], so the account is signed in on ten devices
3. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
4. On device A, open [/devices], click [device.list.revoke-button] on device C's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]
5. On device B, click [user.sign-in.device-limit-dialog.confirm-button]
6. On device B, open [/devices]

### Expected result
- After step 3 [user.sign-in.device-limit-dialog] carries [code:device-limit]
- After step 5 device B is on [/me]
- After step 6 [device.list] holds eleven [device.list.session-item]: device B's in [state:current], device C's in [state:revoked], and device A's, seen least recently, and the eight others in neither
