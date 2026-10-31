---
tags:
  - full
devices:
  A: guest
data: {}
---
# Be shown the steps that install the app where the browser cannot

Where: [/sign-in] in Safari on an iPhone, where only the user's own steps install the app

## Scenario: Safari on an iPhone shows the steps that install the app, which the user can put off

### Steps
1. Open [/sign-in] in Safari on an iPhone and wait for [app-shell.status] to reach [state:ready]
2. Click [app-shell.install-later-button]
3. Reload the page

### Expected result
- After step 1 [app-shell.install-message] carries [code:install-by-steps], with [app-shell.install-later-button] and no [app-shell.install-button]
- After step 2 no [app-shell.install-message] shows
- After step 3 no [app-shell.install-message] shows: it is put off for three days
