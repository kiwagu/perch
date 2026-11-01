---
tags:
  - full
devices:
  A: identity
data: {}
---
# Hear that the server no longer takes the protocol of this version

Where: [/me] after sign-up, when the server refuses the sync protocol of the version the tab runs

## Scenario: A signed-in tab whose sync the server refuses as an outdated protocol says so, and its button loads the page again

### Steps
1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Make the server refuse the sync protocol of the version the tab runs: it closes the sync connection as an outdated protocol
3. Click [app-shell.update-button]

### Expected result
- After step 1 no [app-shell.update-message] shows
- After step 2 [app-shell.update-message] carries [code:protocol-outdated], with [app-shell.update-button], and [app-shell.sync-message] carries [code:sync-stopped]
- After step 3 the page loads again on the version the server serves, [app-shell.status] reaches [state:ready] on [/me] and no [app-shell.update-message] shows
