---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  Bio: generate
  New name: generate
---
# Edit offline and catch up when back online

Where: [/me] on device A, and [/me] on device B, another browser

## Scenario: A bio written offline on one device and a name changed meanwhile on another reach both devices

### Steps
1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]
2. On device B, sign in with the same account and wait for [/me]
3. Take device B offline
4. On device B, enter the bio into [user.profile.bio-textarea] and click [user.profile.save-button]
5. On device A, enter the new name into [user.profile.name-input] and click [user.profile.save-button]
6. Bring device B back online

### Expected result
- After step 3 the sync channel of device B is down
- After step 4 device B shows [app-shell.notice-message] carrying [code:profile-saved] and the bio, and its sync channel is still down
- After step 5 device A shows [app-shell.notice-message] carrying [code:profile-saved] and the new name
- After step 6 the sync channel of device B comes up again
- Then both devices show the new name from device A and the bio from device B
