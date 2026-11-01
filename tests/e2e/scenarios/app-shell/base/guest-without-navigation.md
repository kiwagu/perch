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

Where: [/sign-in], then [/me] once signed in

## Scenario: A guest sees no navigation on the sign-in page; a signed-in account sees it, and it goes again at sign-out

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Sign up with the email, the password and the name, and open the link of [mail:sign-up]
3. Click [user.profile.sign-out-button]

### Expected result
- After step 1 no [app-shell.nav] shows, while [app-shell.theme-select] and [app-shell.locale-select] do
- After step 2 the URL is [/me] and [app-shell.nav] shows [app-shell.nav.profile-link], [app-shell.nav.organisation-link], [app-shell.nav.devices-link] and [app-shell.nav.settings-link]
- After step 3 the URL is [/sign-in] and no [app-shell.nav] shows
