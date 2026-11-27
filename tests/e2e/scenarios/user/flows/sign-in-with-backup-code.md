---
tags:
  - full
devices:
  A: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign in with a backup code of the second factor

Where: [screen:user.sign-in], once the account turned its second factor on at [screen:user.settings]

## Scenario: A backup code takes the place of a code of the app once, and is used up by it

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]
2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]
3. Keep the first two backup codes [user.settings.two-factor.codes-cell] shows, click [user.settings.two-factor.hide-codes-button], click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]
4. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button], enter the first backup code step 3 kept into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]
5. Click [user.profile.sign-out-button], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button], enter that first backup code again into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]
6. Enter the second backup code step 3 kept into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]

### Expected result
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [screen:user.profile]
- After step 5 [user.sign-in.code.error] carries [code:invalid-code] and the URL is still [screen:user.sign-in]: the backup code was used up
- After step 6 [app-shell.notice-message] carries [code:welcome] and the URL is [screen:user.profile]
