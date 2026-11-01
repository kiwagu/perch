---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Other password: generate
  Name: generate
---
# Sign up with the password typed again differently

Where: [/sign-in] then [user.sign-in.toggle-button]

## Scenario: A sign-up whose password typed again differs asks for nothing and says so under it, and goes through once the two are the same

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Click [user.sign-in.toggle-button]
3. Enter the email, the password, the other password and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
4. Enter the password into [user.sign-in.password-confirmation-input] and click [user.sign-in.submit-button]

### Expected result
- After step 3 [user.sign-in.error] carries [code:passwords-differ] under [user.sign-in.password-confirmation-input], which is marked invalid; [user.sign-in.toggle-button] still carries [value:sign-in], the fields keep what was typed, no [user.sign-in.mail-message] shows, and no [mail:sign-up] reaches the email
- After step 4 no [user.sign-in.error] shows, [user.sign-in.mail-message] carries [code:check-your-mail], and [mail:sign-up] reaches the email
