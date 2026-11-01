---
tags:
  - smoke
devices:
  A: identity
data: {}
---
# Choose the theme of this device and the language of the account

Where: [/settings] by [app-shell.nav.settings-link]

## Scenario: A signed-in user chooses the dark theme and Spanish, and both stay after a reload

### Steps
1. Sign up, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.heading]
2. Choose [value:dark] in [user.settings.theme-select]
3. Choose [value:es] in [user.settings.locale-select]
4. Reload the page and wait for [app-shell.status] to reach [state:ready]

### Expected result
- After step 1 the URL is [/settings], [user.settings.theme-select] shows [value:system] and [user.settings.locale-select] shows [value:en]
- After step 2 [user.settings.theme-select] shows [value:dark]
- After step 3 [user.settings.locale-select] shows [value:es] at once
- After step 4 [user.settings.theme-select] still shows [value:dark] and [user.settings.locale-select] still shows [value:es]
