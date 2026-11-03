---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Sign up with the password typed again differently

Where: [/sign-in] then [user.sign-in.toggle-button]

## Scenario: The password typed again is checked as it is typed, and the account is asked for only once the two are the same

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Click [user.sign-in.toggle-button]
3. Enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]
4. Type the password without its last character into [user.sign-in.password-confirmation-input], one character at a time
5. Click [user.sign-in.submit-button]
6. Type the last character of the password into [user.sign-in.password-confirmation-input]
7. Type one more character into [user.sign-in.password-confirmation-input]
8. Delete that character from [user.sign-in.password-confirmation-input] and click [user.sign-in.submit-button]

### Expected result
- During step 4 no [user.sign-in.error] shows
- After step 5 [user.sign-in.error] carries [code:passwords-differ] under [user.sign-in.password-confirmation-input], which is marked invalid; [user.sign-in.submit-button] is disabled, [user.sign-in.toggle-button] still carries [value:sign-in], the fields keep what was typed, no [user.sign-in.mail-message] shows, and no [mail:sign-up] reaches the email
- After step 6 no [user.sign-in.error] shows and [user.sign-in.submit-button] is enabled
- After step 7 [user.sign-in.error] carries [code:passwords-differ] at once and [user.sign-in.submit-button] is disabled
- After step 8 no [user.sign-in.error] shows, [user.sign-in.mail-message] carries [code:check-your-mail], and [mail:sign-up] reaches the email
