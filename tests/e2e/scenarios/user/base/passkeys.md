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
# Add and remove a passkey in the settings

Where: [screen:user.settings], the list [user.settings.passkeys.list], in a browser whose authenticator makes passkeys and unlocks them at once

## Scenario: A passkey is added by the browser, listed, and removed only once the frame's question is confirmed

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.passkeys.list] to leave [state:loading]
2. Click [user.settings.passkeys.add-button]
3. Click [user.settings.passkeys.remove-button] of the passkey
4. Click [app-shell.confirmation.cancel-button]
5. Click [user.settings.passkeys.remove-button] of the passkey and click [app-shell.confirmation.confirm-button]

### Expected result
- After step 1 [user.settings.passkeys.list] carries [state:empty]
- After step 2 [app-shell.toast] carries [code:passkey-added] and [user.settings.passkeys.list] carries [state:ready] with one [user.settings.passkeys.passkey-item], whose [user.settings.passkeys.added-cell] says when it was added
- After step 3 [app-shell.confirmation] carries [code:passkeys-remove]
- After step 4 [app-shell.confirmation] is gone and [user.settings.passkeys.list] still holds the passkey
- After step 5 [app-shell.toast] carries [code:passkey-removed] and [user.settings.passkeys.list] carries [state:empty]
