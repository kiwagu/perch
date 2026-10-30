---
tags:
  - full
devices:
  A: guest
data: {}
---
# Load the newer version of the app the server serves

Where: [/sign-in], while the server starts serving a newer version of the app

## Scenario: A tab coming back to the front says a newer version is served, its button loads it, and a tab sent to the background with nothing unsaved loads it by itself

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Serve a newer version of the app: the manifest at /ui-manifest/manifest.json names a version or a commit other than the one the tab runs
3. Switch to another tab, then back to this one
4. Click [app-shell.update-button]
5. Serve a newer version of the app again
6. Switch to another tab, then back to this one
7. Switch to another tab, then back to this one

### Expected result
- After step 1 no [app-shell.update-message] shows
- After step 3 [app-shell.update-message] carries [code:new-version], with [app-shell.update-button]
- After step 4 the page loads again on the version now served, [app-shell.status] reaches [state:ready] and no [app-shell.update-message] shows
- After step 6 [app-shell.update-message] carries [code:new-version]
- After step 7 the page has loaded again by itself while in the background: [app-shell.status] is in [state:ready] and no [app-shell.update-message] shows
