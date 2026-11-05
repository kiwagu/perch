---
tags:
  - full
devices:
  A: identity
data:
  Other email: generate
  Other password: generate
  Other name: generate
---
# Sign out in another tab while the data opens

Where: [/devices] in a first tab of device A, reloaded while that tab's database engines are held back, and [/me] in a second tab of the same browser

## Scenario: A tab whose account another tab signs out while its data opens goes to the sign-in page at once, then follows the account signed in next

### Steps
1. On device A, sign up, open the link of [mail:sign-up], click [app-shell.nav.devices-link] and wait for [app-shell.status] to reach [state:ready]
2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]
3. Hold back the first tab's database engines, so that its account's data cannot open yet, and reload the first tab
4. In the second tab, click [user.profile.sign-out-button] and wait for [/sign-in]
5. In the second tab, sign up with the other email, the other password and the other name, open the link of [mail:sign-up] and wait for [/me]
6. Let the first tab's database engines load

### Expected result
- After step 3 the first tab's [app-shell.status] reaches [state:opening-data] on [/devices], and its [device.list] holds one [device.list.session-item], in [state:current]
- Within 5 seconds of step 4 the first tab is on [/sign-in] and shows [user.sign-in.form], its database engines still held back
- After step 6 the first tab is on [/me] and its [user.profile.heading] shows the other name: it follows the account signed in next once it can open that account's data
