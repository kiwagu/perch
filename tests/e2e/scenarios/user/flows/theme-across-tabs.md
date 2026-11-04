---
tags:
  - full
devices:
  A: identity
  B: identity
data: {}
---
# Keep the theme of an account in every tab and on every device

Where: [/settings] in two tabs of device A, then [/sign-in] and [/settings] on device B, another browser

## Scenario: A theme chosen in one tab shows in the account's other tab at once, and on the next device it signs in on

### Steps
1. On device A, open [/settings] and wait for [app-shell.status] to reach [state:ready]
2. On device A, open [/settings] in a second tab and wait for [app-shell.status] to reach [state:ready]
3. In the first tab of device A, choose [value:dark] in [user.settings.theme-select]
4. On device B, sign in with the same account, wait for [/me] and open [/settings]
5. On device B, choose [value:light] in [user.settings.theme-select]

### Expected result
- After step 3 the first tab of device A shows [user.settings.theme-select] with [value:dark] at once
- Within 5 seconds of step 3 the second tab of device A shows [user.settings.theme-select] with [value:dark], without a reload
- After step 4 device B shows [user.settings.theme-select] with [value:dark], with no choice made on device B
- After step 5 both tabs of device A show [user.settings.theme-select] with [value:light], without a reload
