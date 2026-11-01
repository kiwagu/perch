---
tags:
  - full
devices:
  A: identity
  B: identity
data: {}
---
# Keep the language of an account on every device

Where: [/settings] on device A, and [/sign-in] then [/settings] on device B, another browser

## Scenario: A language chosen on one device is the language of the account on the next device it signs in on

### Steps
1. On device A, open [/settings] and wait for [app-shell.status] to reach [state:ready]
2. On device A, choose [value:es] in [user.settings.locale-select]
3. On device B, sign in with the same account, wait for [/me] and open [/settings]
4. On device A, choose [value:en] in [user.settings.locale-select]

### Expected result
- After step 2 device A shows [user.settings.locale-select] with [value:es] at once
- After step 3 device B shows [user.settings.locale-select] with [value:es], with no choice made on device B
- After step 4 device B shows [user.settings.locale-select] with [value:en], without a reload
