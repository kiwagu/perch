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
# Turn the second factor on and off in the settings

Where: [/settings], the section [user.settings.two-factor.section]

## Scenario: The second factor turns on only with a code of its key, shows its ten backup codes once, renews them with the password, and turns off with the password

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.two-factor.section] to carry [state:ready]
2. Enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.enable-button]
3. Enter a code the key in [user.settings.two-factor.key-cell] does not give now into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]
4. Enter the code an authenticator app shows now for the key in [user.settings.two-factor.key-cell] into [user.settings.two-factor.code-input] and click [user.settings.two-factor.confirm-button]
5. Click [user.settings.two-factor.hide-codes-button]
6. Reload [/settings] and wait for [user.settings.two-factor.section] to carry [state:ready]
7. Enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.renew-codes-button]
8. Click [user.settings.two-factor.hide-codes-button], enter the password into [user.settings.two-factor.password-input] and click [user.settings.two-factor.disable-button]
9. Reload [/settings] and wait for [user.settings.two-factor.section] to carry [state:ready]

### Expected result
- After step 1 [user.settings.two-factor.off-badge] and [user.settings.two-factor.enable-button] are shown, and [user.settings.two-factor.on-badge] is not
- After step 2 [user.settings.two-factor.key-cell] shows a key, [user.settings.two-factor.password-input] and [user.settings.two-factor.enable-button] are gone, and [user.settings.two-factor.on-badge] is not shown
- After step 3 [user.settings.two-factor.error] carries [code:invalid-code] under [user.settings.two-factor.code-input], and [user.settings.two-factor.on-badge] is not shown
- After step 4 [app-shell.toast] carries [code:two-factor-enabled], [user.settings.two-factor.codes-cell] shows ten different backup codes, and [user.settings.two-factor.on-badge] is shown
- After step 5 [user.settings.two-factor.codes-cell] is gone, and [user.settings.two-factor.disable-button] and [user.settings.two-factor.renew-codes-button] are shown
- After step 6 the URL is still [/settings], so the device stayed signed in through turning the second factor on; [user.settings.two-factor.on-badge] is shown and [user.settings.two-factor.codes-cell] is not: the codes showed once
- After step 7 [user.settings.two-factor.codes-cell] shows ten backup codes, none of them one of step 4's
- After step 8 [app-shell.toast] carries [code:two-factor-disabled], [user.settings.two-factor.on-badge] is gone, [user.settings.two-factor.enable-button] is shown, and the URL is still [/settings]: the device stayed signed in
- After step 9 the URL is still [/settings], [user.settings.two-factor.off-badge] and [user.settings.two-factor.enable-button] are shown: the device stayed signed in through turning the second factor off
