---
tags:
  - smoke
devices:
  A: guest
data: {}
---
# Read the UI manifest and the anchors of a running page

Where: The manifest the stand serves at /ui-manifest/manifest.json, then [/sign-in]

## Scenario: A tool outside the repository reads the manifest the stand serves and matches it with the anchors a running page renders

### Steps
1. Fetch the manifest from /ui-manifest/manifest.json on the stand, and its schema from /ui-manifest/manifest.schema.json beside it
2. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
3. Call the page helper window.__perch.ui.anchors()

### Expected result
- After step 1 the manifest is valid against its schema and names contract version 1
- After step 3 every anchor the helper reports is in the manifest's ids with the same kind, or is derived from one of them with a suffix of that entry's derived
- After step 3 the helper reports the page's URL, on [/sign-in], with [app-shell.status] in [state:ready]
