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
# Open a verification link a second time

Where: [screen:user.verify-email] from a [mail:sign-up] whose link was opened already

## Scenario: A link opened again says the email is verified and signs nothing in

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and wait for [screen:user.profile]
2. Click [user.profile.sign-out-button] and wait for [screen:user.sign-in]
3. Open the link of the same [mail:sign-up] again
4. Click [user.verify-email.sign-in-link]

### Expected result
- After step 3 [user.verify-email.message] carries [code:verified-before], the URL stays [screen:user.verify-email] and [user.verify-email.sign-in-link] shows
- After step 4 the URL is [screen:user.sign-in]
