---
tags:
  - full
devices:
  A: guest
  B: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Start a new account in the language chosen as a guest

Where: [/sign-in] on device A, then [/me] on device A and on device B, another browser

## Scenario: A language chosen on the sign-in page is the language a new account starts with, on every device

### Steps
1. On device A, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. On device A, choose [value:es] in [app-shell.locale-select]
3. On device A, click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
4. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]

### Expected result
- After step 3 device A is on [/me] and shows [app-shell.locale-select] with [value:es]
- After step 4 device B is on [/me] and shows [app-shell.locale-select] with [value:es], with no choice made on device B
