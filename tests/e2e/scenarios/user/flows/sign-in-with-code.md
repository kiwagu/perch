---
tags:
  - smoke
devices:
  A: identity
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign in with a code of the second factor

Where: [/sign-in], once the account turned its second factor on at [/settings]

## Scenario: The right password of an account whose second factor is on asks for a code and signs nothing in until a code of its key is taken; going back starts again from the password

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]
2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input], click [user.settings.two-factor.confirm-button] and click [user.settings.two-factor.hide-codes-button]
3. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]
4. Enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]
5. Click [user.sign-in.code.dialog.cancel-button]
6. Click [user.sign-in.submit-button] again
7. Enter a code the key does not give now into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]
8. Enter the code the authenticator app shows now for the key into [user.sign-in.code.code-input] and click [user.sign-in.code.dialog.confirm-button]

### Expected result
- After step 4 [user.sign-in.code.dialog] carries [code:code-required] and the URL is still [/sign-in]: nothing is signed in yet
- After step 5 [user.sign-in.code.dialog] is gone and the URL is still [/sign-in]
- After step 6 [user.sign-in.code.dialog] carries [code:code-required] again
- After step 7 [user.sign-in.code.error] carries [code:invalid-code] under [user.sign-in.code.code-input], and the URL is still [/sign-in]
- After step 8 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
