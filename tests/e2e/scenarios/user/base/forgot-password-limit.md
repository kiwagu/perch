---
tags:
  - full
devices:
  A: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Ask for the reset mail too often

Where: [/forgot-password], four requests for one email within a quarter of an hour

## Scenario: One email takes three reset requests within a quarter of an hour; the fourth is refused and sends nothing

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]
2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button] three times, waiting for [user.forgot-password.message] each time
3. Click [user.forgot-password.send-button] once more

### Expected result
- After step 2 three [mail:request-password-reset] reach the email
- After step 3 [user.forgot-password.error] carries [code:rate-limited], and no fourth [mail:request-password-reset] reaches the email
