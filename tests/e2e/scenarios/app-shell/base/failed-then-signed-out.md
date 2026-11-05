---
tags:
  - full
devices:
  A: identity
data: {}
---
# Sign out in another tab after the data did not open

Where: [/me] in a first tab of device A whose database engines the browser refuses, and [/me] in a second tab of the same browser

## Scenario: A tab that could not open the account's data goes to the sign-in page once another tab signs the account out, and no longer offers to sign it out

### Steps
1. On device A, sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]
3. Make the browser refuse the first tab's database engines, as when the network drops them, and reload the first tab
4. In the second tab, click [user.profile.sign-out-button] and wait for [/sign-in]

### Expected result
- After step 3 the first tab's [app-shell.status] is in [state:failed] and it offers [app-shell.sign-out-here-button]
- Within 5 seconds of step 4 the first tab is on [/sign-in] and shows [user.sign-in.form], and no [app-shell.sign-out-here-button]
