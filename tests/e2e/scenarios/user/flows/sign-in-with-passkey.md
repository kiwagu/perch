---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign in with a passkey

Where: [/sign-in] by [user.sign-in.passkey-button], in a browser whose authenticator makes passkeys, unlocks them at once and keeps them until the browser closes, whatever the account does with them

## Scenario: A passkey signs the account in with no password and no code, even with the second factor on, and one removed from the account signs nothing in

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and click [user.settings.passkeys.add-button]
2. Enter the password into [user.settings.two-factor.password-input], click [user.settings.two-factor.enable-button], enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input], click [user.settings.two-factor.confirm-button] and click [user.settings.two-factor.hide-codes-button]
3. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]
4. Click [user.sign-in.passkey-button]
5. Click [app-shell.nav.settings-link], click [user.settings.passkeys.remove-button] of the passkey and click [app-shell.confirmation.confirm-button]
6. Click [app-shell.nav.profile-link], click [user.profile.sign-out-button] and click [user.sign-in.passkey-button]

### Expected result
- After step 4 [app-shell.notice-message] carries [code:welcome], the URL is [/me], and [user.sign-in.code.dialog] never showed
- After step 5 [user.settings.passkeys.list] holds no [user.settings.passkeys.passkey-item]
- After step 6 the authenticator offers the passkey it still keeps, [user.sign-in.error] carries [code:passkey-unknown], and the URL is still [/sign-in]: the account no longer has that passkey
