---
tags:
  - full
devices:
  A: identity
data: {}
---
# Choose the theme of this device from the frame, as a guest and signed in

Where: [/sign-in] for a guest, then [/settings] after sign-up

## Scenario: A guest chooses the dark theme on the sign-in page, it stays after a reload, and the settings screen shows the same theme after sign-up

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Choose [value:dark] in [app-shell.theme-select]
3. Reload the page and wait for [app-shell.status] to reach [state:ready]
4. Sign up, click [app-shell.nav.settings-link] and wait for [user.settings.heading]
5. Choose [value:light] in [app-shell.theme-select]

### Expected result
- After step 1 [app-shell.theme-select] shows [value:system]
- After step 2 [app-shell.theme-select] shows [value:dark]
- After step 3 [app-shell.theme-select] still shows [value:dark]
- After step 4 [user.settings.theme-select] shows [value:dark], the theme chosen as a guest
- After step 5 [user.settings.theme-select] shows [value:light] at once, the same theme as [app-shell.theme-select]
