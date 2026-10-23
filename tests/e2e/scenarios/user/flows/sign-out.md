---
tags:
  - full
activity: session
devices:
  A: identity
  B: identity
data:
  Bio: generate
  New name: generate
  Unsent name: generate
---
# Sign out of one device

Where: [/me] then [user.profile.sign-out-button] on device A, and [/me] on device B, another browser

## Scenario: Signing out deletes the device's data and leaves the other device signed in, and asks first while changes are unsent

### Steps
1. On device A, open [/me], enter the bio into [user.profile.bio-textarea] and click [user.profile.save-button]
2. On device B, sign in with the same account and wait for [/me]
3. On device A, click [user.profile.sign-out-button]
4. On device B, enter the new name into [user.profile.name-input] and click [user.profile.save-button]
5. On device A, sign in again with the same account and wait for [/me]
6. Take device A's browser offline, enter the unsent name into [user.profile.name-input] and click [user.profile.save-button]
7. On device A, click [user.profile.sign-out-button]
8. Click [user.profile.sign-out-dialog.cancel-button]

### Expected result
- After step 3 device A is on [/sign-in] and its browser keeps no local database of the account
- After step 4 device B, still signed in, shows [app-shell.notice-message] carrying [code:profile-saved]
- After step 5 device A shows the profile the server holds: the new name from device B and the bio from step 1
- After step 7 device A asks at once, without waiting for the sync channel, before deleting the change it could not send: [user.profile.sign-out-dialog] carries [code:unsent-changes]
- After step 8 device A stays on [/me] with the unsent name, and its local database is kept
