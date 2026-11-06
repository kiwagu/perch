---
tags:
  - full
devices:
  A: guest
  B: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign in past the number of devices an account may be signed in on

Where: [/sign-in] on device B, and [/me] on device A, another browser

## Scenario: A sign-in past the account's limit asks first, signs out the device seen least recently once confirmed, and that device learns why when it connects again

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. Take device A's browser offline
3. Sign the account in on nine more devices, each a browser of its own, so it is signed in on ten
4. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
5. Click [user.sign-in.device-limit-dialog.cancel-button]
6. Click [user.sign-in.submit-button] again
7. Click [user.sign-in.device-limit-dialog.confirm-button]
8. On device B, open [/devices]
9. Bring device A's browser back online

### Expected result
- After step 4 [user.sign-in.device-limit-dialog] carries [code:device-limit], and device B is still on [/sign-in]: nothing is signed in yet
- After step 5 [user.sign-in.device-limit-dialog] is gone and device B is still on [/sign-in]
- After step 6 [user.sign-in.device-limit-dialog] carries [code:device-limit] again
- After step 7 device B is on [/me]
- After step 8 [device.list] holds eleven [device.list.session-item]: device B's in [state:current], device A's in [state:revoked] and the nine others in neither
- After step 9 device A is on [/sign-in] once it connects again, where [user.sign-in.notice-message] carries [code:device-limit-elsewhere]
