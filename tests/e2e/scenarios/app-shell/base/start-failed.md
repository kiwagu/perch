---
tags:
  - smoke
devices:
  A: identity
data: {}
---
# Open the app when the code of its start does not load

Where: [/me] after sign-up, reloaded while the browser refuses the page the code of the app's start

## Scenario: A start whose code does not load says the app could not start and offers no sign-out, although an account is saved

### Steps
1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Make the browser refuse the page the code of the app's start, which loads after the first frame, as when the network drops it
3. Reload the page

### Expected result
- After step 3 [app-shell.status] is in [state:start-failed]: the page says the app could not start on this device, and to reload the page to try again
- The page shows [app-shell.theme-select] and [app-shell.locale-select], and no [app-shell.sign-out-here-button] and no [app-shell.nav]
