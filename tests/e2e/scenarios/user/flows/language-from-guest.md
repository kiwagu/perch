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

Where: [/sign-in] on device A, [/verify-email] on device B, another browser, then [/me] and [/settings] on both

## Scenario: The language chosen on the sign-in page is the language of the verification mail and the one the new account starts with, on the device that opens the link and on every other

### Steps
1. On device A, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]
2. On device A, choose [value:es] in [app-shell.locale-select]
3. On device A, click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
4. On device B, open the link of [mail:sign-up]
5. On device A, enter the password into [user.sign-in.password-input] and click [user.sign-in.submit-button]

### Expected result
- After step 3 device A stays on [/sign-in] with [user.sign-in.mail-message] carrying [code:check-your-mail], and [mail:sign-up] reaches the email in the language [value:es]
- After step 4 device B is on [/me], and its [/settings] shows [user.settings.locale-select] with [value:es], with no choice made on device B
- After step 5 device A is on [/me], and its [/settings] shows [user.settings.locale-select] with [value:es]
