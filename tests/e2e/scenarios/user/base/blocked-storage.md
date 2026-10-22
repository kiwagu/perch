---
tags:
  - smoke
devices:
  A: guest
data: {}
---
# Open the app in a browser that blocks site data

Where: [/sign-in] in a browser that refuses the page its localStorage

## Scenario: A browser that keeps no site data is told so instead of being sent to sign-in again and again

### Steps
1. Make the browser refuse the page its localStorage, as when site data is blocked
2. Open [/sign-in]

### Expected result
- After step 2 [app-shell.status] is in [state:storage-blocked]: the page says that this browser does not let Perch keep data on this device, and to allow site data for this site, then reload the page
- The page shows no [user.sign-in.form]
