---
tags:
  - smoke
devices:
  A: guest
data: {}
---
# Open the sign-in page without the database engines

Where: [/sign-in] as a guest, while the page's database engines are held back

## Scenario: A guest gets the sign-in form although the database engines cannot load

### Steps
1. Hold back the page's database engines, so that none of them can load
2. Open [/sign-in] as a guest

### Expected result
- After step 2 [app-shell.status] reaches [state:ready] and [user.sign-in.form] is shown
