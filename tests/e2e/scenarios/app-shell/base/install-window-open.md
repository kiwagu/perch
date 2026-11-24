---
tags:
  - full
devices:
  A: identity
data: {}
---
# Follow the sync while the browser's install window is open

Where: [/me] on device A, after sign-up, in a browser that offers to install the app

## Scenario: The state of the sync shows while the browser's window to install the app is open, and the reminder goes once the app is installed

### Steps
1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]
2. The browser offers to install the app
3. Click [app-shell.install-button]; the browser's window to install the app opens and stays open
4. Take the browser offline
5. Accept the browser's window
6. Bring the browser back online

### Expected result
- After step 1 [app-shell.sync-message] carries [code:synced]
- After step 2 [app-shell.install-message] carries [code:install-available]
- After step 4 [app-shell.sync-message] carries [code:offline] while the browser's window is open
- After step 5 no [app-shell.install-message] shows, and [app-shell.sync-message] still carries [code:offline]
- After step 6 [app-shell.sync-message] carries [code:synced]
