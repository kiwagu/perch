---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
---
# Leave the sign-in form by its forgot-password link

Where: [/sign-in], then [/forgot-password] through [user.sign-in.forgot-link]

## Scenario: A guest who typed a password is asked before the link loses it, while the email it carries asks nothing

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Enter the email into [user.sign-in.email-input] and the password into [user.sign-in.password-input]
3. Click [user.sign-in.forgot-link]
4. Click [app-shell.leave-dialog.cancel-button]
5. Click [user.sign-in.forgot-link]
6. Click [app-shell.leave-dialog.confirm-button]
7. Open [/sign-in], wait for [app-shell.status] to reach [state:ready], enter the email into [user.sign-in.email-input] and click [user.sign-in.forgot-link]

### Expected result
- After step 3 [app-shell.leave-dialog] carries [code:unsaved-input] and the page stays on [/sign-in]
- After step 4 [user.sign-in.password-input] still holds the password, and no [app-shell.leave-dialog] is shown
- After step 6 the page is on [/forgot-password] and [user.forgot-password.email-input] shows the email
- After step 7 the page is on [/forgot-password] without [app-shell.leave-dialog] having been shown, and [user.forgot-password.email-input] shows the email
