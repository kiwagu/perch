---
tags:
  - full
devices:
  A: identity
data: {}
---
# Sign out while another tab holds the data open

Where: [/me] then [user.profile.sign-out-button] in a first tab of device A, while a second tab of the same browser holds the account's local database open

## Scenario: A sign-out ends even though another tab holds the data open, says so, and the data goes once that tab closes

### Steps
1. On device A, open [/me] in a first tab and wait for [app-shell.status] to reach [state:ready]
2. On device A, open a second tab that holds the account's local database open and never lets it go, as a frozen tab would
3. In the first tab, click [user.profile.sign-out-button]
4. Close the second tab

### Expected result
- Within 15 seconds of step 3 the first tab is on [/sign-in] and [user.sign-in.notice-message] carries [code:delete-pending]: the device is signed out, and its data leaves it once the other Perch tabs are closed
- After step 3 the browser still keeps the account's local database
- Within 10 seconds of step 4 the browser keeps no local database of the account
