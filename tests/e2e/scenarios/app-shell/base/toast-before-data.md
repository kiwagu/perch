---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# See a toast before the data opens

Where: [/settings] after sign-up, reloaded while the page's database engines are held back

## Scenario: A password changed while the account's data opens says so at once, before the data is open

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Hold back the page's database engines, so that the account's data cannot open yet
3. Reload the page
4. Enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]

### Expected result
- After step 3 [app-shell.status] reaches [state:opening-data] on [/settings]
- After step 4 [app-shell.toast] carries [code:password-changed] while [app-shell.status] is still in [state:opening-data]
