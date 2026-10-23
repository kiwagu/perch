---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  Bio: generate
  New name: generate
  Draft name: generate
  Second name: generate
---
# Keep one account in step on two devices

Where: [/me] on device A, and [/me] on device B, another browser

## Scenario: A bio written on one device and a name changed on another reach both devices, and a name being typed is not overwritten

### Steps
1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]
2. On device A, enter the bio into [user.profile.bio-textarea] and click [user.profile.save-button]
3. On device B, sign in with the same account and wait for [/me]
4. On device B, enter the new name into [user.profile.name-input] and click [user.profile.save-button]
5. On device A, enter the draft name into [user.profile.name-input] without saving
6. On device B, enter the second name into [user.profile.name-input] and click [user.profile.save-button]
7. On device A, click [user.profile.save-button]

### Expected result
- After step 2 device A shows [app-shell.notice-message] carrying [code:profile-saved]
- After step 3 device B shows the bio entered on device A in [user.profile.bio-textarea]
- Within 5 seconds of step 4 device A shows the new name in [user.profile.heading], without a reload
- The time from the click on device B to the new name on device A is reported as "sync-latency-ms"
- After step 6 device A shows the second name in [user.profile.heading] and still holds the draft name in [user.profile.name-input]
- After step 7 device B shows the draft name in [user.profile.heading] and in [user.profile.name-input]
