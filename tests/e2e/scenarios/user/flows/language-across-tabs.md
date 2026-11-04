---
tags:
  - full
devices:
  A: identity
data: {}
---
# Keep the language of an account in every tab

Where: [/settings] in two tabs of device A

## Scenario: A language chosen in one tab is spoken in the account's other tab at once

### Steps
1. In a first tab, open [/settings] and wait for [app-shell.status] to reach [state:ready]
2. In a second tab, open [/settings] and wait for [app-shell.status] to reach [state:ready]
3. In the first tab, choose [value:es] in [user.settings.locale-select]

### Expected result
- After step 3 the first tab shows [user.settings.locale-select] with [value:es] at once
- Within 5 seconds of step 3 the second tab shows [user.settings.locale-select] with [value:es], without a reload
