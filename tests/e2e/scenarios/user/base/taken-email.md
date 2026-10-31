---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  Other password: generate
---
# Sign up again with an email that has an account

Where: [/sign-in] then [user.sign-in.toggle-button], for an email that has an account

## Scenario: A sign-up with a taken email answers as a new one does, sends no mail, and the account keeps its own password

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Click [user.sign-in.toggle-button], enter the email, the other password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
3. Enter the other password into [user.sign-in.password-input] and click [user.sign-in.submit-button]
4. Enter the password into [user.sign-in.password-input] and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.sign-in.mail-message] carries [code:check-your-mail], as after the sign-up of a new email, the URL stays [/sign-in], and no second [mail:sign-up] reaches the email
- After step 3 [user.sign-in.error] carries [code:invalid-credentials]
- After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is [/me]
