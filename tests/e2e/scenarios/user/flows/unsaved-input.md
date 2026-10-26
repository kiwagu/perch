---
tags:
  - full
devices:
  A: identity
data:
  New name: generate
---
# Leave the profile with an unsaved name

Where: [/me] then [app-shell.nav.organisation-link]

## Scenario: A signed-in user is asked before an unsaved name is lost, and not when nothing would be lost

### Steps
1. Open [/me] and wait for [app-shell.status] to reach [state:ready]
2. Enter the new name into [user.profile.name-input]
3. Click [app-shell.nav.organisation-link]
4. Click [app-shell.leave-dialog.cancel-button]
5. Click [app-shell.nav.organisation-link]
6. Click [app-shell.leave-dialog.confirm-button]
7. Open [/me], enter the new name into [user.profile.name-input], then enter the stored name back
8. Click [app-shell.nav.organisation-link]
9. Open [/me], enter the new name into [user.profile.name-input] and reload the page, accepting the browser's prompt

### Expected result
- After step 3 [app-shell.leave-dialog] carries [code:unsaved-input] and the page stays on [/me]
- After step 4 [user.profile.name-input] still shows the new name, and no [app-shell.leave-dialog] is shown
- After step 6 the page is on [/org]
- After step 8 the page is on [/org] without [app-shell.leave-dialog] having been shown
- At step 9 the browser's own prompt is shown before the reload; after it [user.profile.name-input] shows the stored name
