---
tags:
  - full
devices:
  A: identity
  B: identity
data:
  New name: generate
  Second name: generate
  Bio: generate
---
# Sync from one tab per browser

Where: [/me] in two tabs of device A, and [/me] on device B, another browser

## Scenario: Two tabs of one browser share one sync leader, both tabs' edits reach the other device, and the other tab takes over when the leader closes

### Steps
1. On device A, open [/me] in a first tab and wait for [app-shell.status] to reach [state:ready]
2. On device A, open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]
3. On device B, sign in with the same account and wait for [/me]
4. In the tab of device A that does not lead the sync, enter the new name into [user.profile.name-input] and click [user.profile.save-button]
5. On device A, enter the second name into [user.profile.name-input] in the tab that leads the sync and the bio into [user.profile.bio-textarea] in the other tab, then click [user.profile.save-button] in both tabs at the same moment
6. Close the tab of device A that leads the sync

### Expected result
- After step 2 exactly one of the two tabs of device A leads the sync, and only that tab holds a sync channel
- Within 5 seconds of step 4 device B shows the new name
- Within 5 seconds of step 5 device B shows the second name and the bio: the edit of each tab arrives
- Within 2 seconds of step 6 the remaining tab of device A leads the sync, and its sync channel then comes up
