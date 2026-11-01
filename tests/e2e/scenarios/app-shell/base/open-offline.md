---
tags:
  - full
devices:
  A: identity
data: {}
---
# Open the app without a network

Where: [/me] after sign-up, then the same page with the browser offline

## Scenario: A signed-in device that loaded the app once opens it again offline, with its own data

### Steps
1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]
2. Reload the page and wait for [app-shell.status] to reach [state:ready]
3. Take the browser offline
4. Reload the page

### Expected result
- After step 4 [app-shell.status] reaches [state:ready] on [/me], [user.profile.heading] shows the name the account signed up with, and [app-shell.sync-message] carries [code:offline]
