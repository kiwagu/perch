---
tags:
  - smoke
devices:
  A: identity
data:
  New name: generate
---
# Rename yourself on the profile page

Where: [screen:user.profile] then [user.profile.save-button]

## Scenario: A signed-in user changes their name and keeps it after a reload

### Steps
1. Open [screen:user.profile] and wait for [app-shell.status] to reach [state:ready]
2. Clear [user.profile.name-input]
3. Enter the new name into [user.profile.name-input]
4. Click [user.profile.save-button]

### Expected result
- After step 4 [app-shell.toast] carries [code:profile-saved]
- [user.profile.heading] shows the new name
- Reloading the page keeps the new name
