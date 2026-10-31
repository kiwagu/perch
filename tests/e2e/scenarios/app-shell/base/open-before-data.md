---
tags:
  - smoke
devices:
  A: identity
data: {}
---
# See the frame and the screen before the data opens

Where: [/me] after sign-up, reloaded while the page's database engines are held back

## Scenario: A signed-in device shows its frame and the open screen while its data opens, then the data

### Steps
1. Sign up and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Hold back the page's database engines, so that the account's data cannot open yet
3. Reload the page
4. Let the database engines load

### Expected result
- After step 3 [app-shell.status] reaches [state:opening-data] on [/me]: [app-shell.nav] shows [app-shell.nav.profile-link], [app-shell.nav.organisation-link], [app-shell.nav.devices-link] and [app-shell.nav.settings-link], and [user.profile.status] is in [state:loading]
- After step 4 [app-shell.status] reaches [state:ready] and [user.profile.heading] shows the name the account signed up with
