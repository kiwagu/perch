---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# See no navigation as a guest

Where: [screen:user.sign-in], then [screen:user.profile] once signed in

## Scenario: A guest sees no navigation on the sign-in page; a signed-in account sees it, and it goes again at sign-out

### Steps
1. Open [screen:user.sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Sign up with the email, the password and the name, and open the link of [mail:sign-up]
3. Click [user.profile.sign-out-button]

### Expected result
- After step 1 no [app-shell.nav] shows, while [app-shell.theme-select] and [app-shell.locale-select] do
- After step 2 the URL is [screen:user.profile] and [app-shell.nav] shows [app-shell.nav.profile-link], [app-shell.nav.organisation-link], [app-shell.nav.devices-link] and [app-shell.nav.settings-link]
- After step 3 the URL is [screen:user.sign-in] and no [app-shell.nav] shows
