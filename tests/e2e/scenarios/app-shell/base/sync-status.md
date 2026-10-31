---
tags:
  - full
devices:
  A: identity
data:
  New name: generate
---
# See the state of this device's sync in every tab

Where: [/me] in two tabs of device A, after sign-up

## Scenario: Both tabs of a browser say the same state of its sync through a dropped connection, the network going and an edit made offline

### Steps
1. Sign up and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]
3. Drop the sync connection while the browser keeps its network, and refuse a new one for now
4. Let the sync connect again
5. Take the browser offline
6. In the second tab, enter the new name into [user.profile.name-input] and click [user.profile.save-button]
7. Bring the browser back online

### Expected result
- After step 1 [app-shell.sync-message] carries [code:synced]
- After step 2 [app-shell.sync-message] carries [code:synced] in both tabs
- After step 3 [app-shell.sync-message] carries [code:connecting] in both tabs
- After step 4 [app-shell.sync-message] carries [code:synced] in both tabs
- After step 5 [app-shell.sync-message] carries [code:offline] in both tabs
- After step 6 the second tab shows the new name, and [app-shell.sync-message] still carries [code:offline] in both tabs
- After step 7 [app-shell.sync-message] carries [code:synced] in both tabs: the new name was sent
