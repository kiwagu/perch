---
tags:
  - full
devices:
  A: guest
data: {}
---
# Be reminded to install the app until it is installed

Where: [/sign-in], in a browser that offers to install the app

## Scenario: The reminder comes with the browser's offer, goes for three days when put off, comes back, and goes for good once the app is installed

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. The browser offers to install the app
3. Click [app-shell.install-later-button]
4. Reload the page; the browser offers to install the app again
5. Three days later, reload the page; the browser offers to install the app again
6. Click [app-shell.install-button] and accept the browser's window
7. Reload the page; the browser offers to install the app again

### Expected result
- After step 1 no [app-shell.install-message] shows
- After step 2 [app-shell.install-message] carries [code:install-available], with [app-shell.install-button] and [app-shell.install-later-button]
- After step 3 no [app-shell.install-message] shows
- After step 4 no [app-shell.install-message] shows: it is put off for three days
- After step 5 [app-shell.install-message] carries [code:install-available] again
- After step 6 no [app-shell.install-message] shows
- After step 7 no [app-shell.install-message] shows: the app is installed on this device
