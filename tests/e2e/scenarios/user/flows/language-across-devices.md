---
tags:
  - full
devices:
  A: identity
  B: identity
data: {}
---
# Keep the language of an account on every device

Where: [/me] on device A, and [/sign-in] then [/me] on device B, another browser

## Scenario: A language chosen on one device is the language of the account on the next device it signs in on

### Steps
1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]
2. On device A, choose [value:es] in [app-shell.locale-select]
3. On device B, sign in with the same account and wait for [/me]

### Expected result
- After step 2 device A shows [app-shell.locale-select] with [value:es] at once
- After step 3 device B shows [app-shell.locale-select] with [value:es], with no choice made on device B
