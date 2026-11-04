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
  Wrong password: generate
---
# Change the password in the settings

Where: [/settings], the form [user.settings.password.form]

## Scenario: The password changes only with the current one right; the toast says so, and the account then signs in with the new one

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the wrong password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]
3. Enter the password into [user.settings.password.current-password-input] and click [user.settings.password.save-button]
4. Click [app-shell.nav.profile-link], click [user.profile.sign-out-button], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.settings.password.error] carries [code:invalid-credentials] under [user.settings.password.current-password-input]
- After step 3 [app-shell.toast] carries [code:password-changed], the fields of [user.settings.password.form] are empty, and [notice:change-password.password-changed] reaches the email
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
