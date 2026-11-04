---
tags:
  - full
devices:
  A: identity
data: {}
---
# Choose the theme of this device from the frame as a guest, and the account starts with it

Where: [/sign-in] for a guest, then [/settings] after sign-up, then [/sign-in] after the sign-out

## Scenario: A guest chooses the dark theme on the sign-in page, it stays after a reload, the account created on this device starts with it, and after a sign-out the frame shows the theme the account showed last

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Choose [value:dark] in [app-shell.theme-select]
3. Reload the page and wait for [app-shell.status] to reach [state:ready]
4. Sign up, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.heading]
5. Choose [value:light] in [user.settings.theme-select]
6. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]

### Expected result
- After step 1 [app-shell.theme-select] shows [value:system]
- After step 2 [app-shell.theme-select] shows [value:dark]
- After step 3 [app-shell.theme-select] still shows [value:dark]
- After step 4 no [app-shell.theme-select] shows, and [user.settings.theme-select] shows [value:dark], the theme chosen as a guest
- After step 5 [user.settings.theme-select] shows [value:light]
- After step 6 the URL is [/sign-in] and [app-shell.theme-select] shows [value:light], the theme this device showed last
