---
tags:
  - full
devices:
  A: identity
  B: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
---
# Change the password while another device is offline

Where: [/settings] on device A, and [/me] on device B, another browser

## Scenario: A device signed out by a change of the password while it was offline learns why when it connects again

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]
3. Take device B's browser offline
4. On device A, open [/settings], enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]
5. Bring device B's browser back online

### Expected result
- After step 4 [app-shell.toast] carries [code:password-changed] on device A, and device B is still on [/me]
- Within 5 seconds of step 5 device B is on [/sign-in], where [user.sign-in.notice-message] carries [code:password-changed-elsewhere]
