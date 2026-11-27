---
tags:
  - smoke
activity: session
devices:
  A: identity
data: {}
---
# Sign out of a device whose data will not open

Where: [screen:user.profile] then [app-shell.sign-out-here-button], once the account's local database is broken

## Scenario: A device that cannot open the account's data offers to sign out on it, which leaves nothing of the account behind

### Steps
1. Open [screen:user.profile] and wait for [app-shell.status] to reach [state:ready]
2. Leave the app for another page of the same site and break the account's local database, so that the app can no longer open it
3. Open [screen:user.profile]
4. Click [app-shell.sign-out-here-button]

### Expected result
- After step 3 [app-shell.status] is in [state:failed]: the page says this device could not open the data, to reload the page to try again or sign out on this device, and that changes it has not sent yet are lost; it offers [app-shell.sign-out-here-button]
- Within 15 seconds of step 4 the page is on [screen:user.sign-in] and shows [user.sign-in.form]
- Within 15 seconds of step 4 the browser keeps no local database of the account and no longer names the account as signed in
