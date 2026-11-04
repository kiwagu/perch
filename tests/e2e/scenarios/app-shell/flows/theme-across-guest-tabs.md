---
tags:
  - full
devices:
  A: guest
data: {}
---
# Follow a guest's theme in every tab of the browser

Where: [/sign-in] in two tabs of device A, no account signed in

## Scenario: A theme a guest chooses in one tab shows in the browser's other tab at once

### Steps
1. In a first tab, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. In a second tab, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
3. In the first tab, choose [value:dark] in [app-shell.theme-select]

### Expected result
- After step 2 [app-shell.theme-select] shows [value:system] in both tabs
- After step 3 the first tab's [app-shell.theme-select] shows [value:dark] at once
- Within 5 seconds of step 3 the second tab's [app-shell.theme-select] shows [value:dark], without a reload
