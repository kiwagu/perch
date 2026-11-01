---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
  Lowercase only: "abcdefghij"
  Every rule: "Abcdefghij1!"
  With a space: "Abcdefg hij1!"
  Too long: "Abcdefghij1!Abcdefghij1!Abcdefghij1!"
---
# Sign up with a password that keeps the rules

Where: [/sign-in] then [user.sign-in.toggle-button]

## Scenario: The rules of a new password are marked as it is typed, and the account is asked for only once the password keeps them all

### Steps
1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. Click [user.sign-in.toggle-button]
3. Enter the lowercase only into [user.sign-in.password-input]
4. Enter the every rule into [user.sign-in.password-input]
5. Enter the with a space into [user.sign-in.password-input]
6. Enter the too long into [user.sign-in.password-input]
7. Enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]

### Expected result
- After step 2 [user.sign-in.password-rule-list] shows and none of [user.sign-in.password-rule-list.length-item], [user.sign-in.password-rule-list.characters-item], [user.sign-in.password-rule-list.digit-item], [user.sign-in.password-rule-list.uppercase-item], [user.sign-in.password-rule-list.lowercase-item] and [user.sign-in.password-rule-list.symbol-item] carries [state:met]; [user.sign-in.submit-button] is disabled
- After step 3 [user.sign-in.password-rule-list.length-item], [user.sign-in.password-rule-list.characters-item] and [user.sign-in.password-rule-list.lowercase-item] carry [state:met], [user.sign-in.password-rule-list.digit-item], [user.sign-in.password-rule-list.uppercase-item] and [user.sign-in.password-rule-list.symbol-item] do not, and [user.sign-in.submit-button] is disabled
- After step 4 every item of [user.sign-in.password-rule-list] carries [state:met], and no [user.sign-in.error] shows
- After step 5 [user.sign-in.password-rule-list.characters-item] no longer carries [state:met] and [user.sign-in.submit-button] is disabled
- After step 6 [user.sign-in.password-rule-list.length-item] no longer carries [state:met], [user.sign-in.password-rule-list.characters-item] carries it again, and [user.sign-in.submit-button] is disabled
- After step 7 [user.sign-in.mail-message] carries [code:check-your-mail], [mail:sign-up] reaches the email, and no [user.sign-in.password-rule-list] shows
