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
# Sign in past the number of devices an account may be signed in on

Where: [/sign-in] on device B, and [/me] on devices A and C to K, each another browser

## Scenario: A sign-in past the account's limit asks first and, once confirmed, signs out the device seen least recently rather than the one signed in first, which learns why when it connects again

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On devices C to K in turn, sign in with the same account and wait for [/me], so the account is signed in on ten devices
3. On device A, reload [/me] and wait for [app-shell.status] to reach [state:ready]
4. Take device C's browser offline
5. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
6. Click [user.sign-in.device-limit-dialog.cancel-button]
7. Click [user.sign-in.submit-button] again
8. Click [user.sign-in.device-limit-dialog.confirm-button]
9. On device B, open [/devices]
10. Bring device C's browser back online

### Expected result
- After step 5 [user.sign-in.device-limit-dialog] carries [code:device-limit], and device B is still on [/sign-in]: nothing is signed in yet
- After step 6 [user.sign-in.device-limit-dialog] is gone and device B is still on [/sign-in]
- After step 7 [user.sign-in.device-limit-dialog] carries [code:device-limit] again
- After step 8 device B is on [/me]
- After step 9 [device.list] holds eleven [device.list.session-item]: device B's in [state:current], device C's in [state:revoked], and device A's and the eight others in neither
- After step 10 device C is on [/sign-in] once it connects again, where [user.sign-in.notice-message] carries [code:device-limit-elsewhere]
