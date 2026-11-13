---
tags:
  - full
devices:
  A: identity
data:
  New name: generate
  Email: generate
---
# See a field's unsaved and saved states

Where: [/me], then [/settings]

## Scenario: A signed-in user sees a name field unsaved and then saved, and an email field that runs an action only unsaved

### Steps
1. Open [/me] and wait for [app-shell.status] to reach [state:ready]
2. Enter the new name into [user.profile.name-input]
3. Click [user.profile.save-button]
4. Reload the page and wait for [app-shell.status] to reach [state:ready]
5. Open [/settings] and enter the email into [user.settings.email.email-input]

### Expected result
- After step 2 [user.profile.name-input] carries [state:unsaved]
- After step 3 [user.profile.name-input] carries [state:saved]
- After step 4 [user.profile.name-input] shows the new name and carries no state
- After step 5 [user.settings.email.email-input] carries [state:unsaved]
