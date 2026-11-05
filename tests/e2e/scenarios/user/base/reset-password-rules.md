---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  New password: generate
  Other password: generate
  Lowercase only: "abcdefghij"
---
# Keep the rules and type the new password twice on the reset page

Where: [/reset-password] from [mail:request-password-reset]

## Scenario: The reset page holds the new password to its rules and to the password typed again before it sets it

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input], click [user.forgot-password.send-button], and open the link of [mail:request-password-reset]
3. Enter the lowercase only into [user.reset-password.password-input]
4. Enter the new password into [user.reset-password.password-input] and the other password into [user.reset-password.password-confirmation-input]
5. Enter the new password into [user.reset-password.password-confirmation-input] and click [user.reset-password.submit-button]

### Expected result
- After step 3 [user.reset-password.password-rule-list.lowercase-item] carries [state:met], [user.reset-password.password-rule-list.digit-item] does not, and [user.reset-password.submit-button] is disabled
- After step 4 [user.reset-password.error] carries [code:passwords-differ] under [user.reset-password.password-confirmation-input] and [user.reset-password.submit-button] is disabled
- After step 5 [user.reset-password.message] carries [code:password-reset]
