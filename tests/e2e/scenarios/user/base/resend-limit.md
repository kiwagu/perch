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
# Ask for the verification mail again too often

Where: [/sign-in] after a sign-up, then [user.sign-in.resend-button] four times within a quarter of an hour

## Scenario: One email takes three resends of its verification mail within a quarter of an hour; the fourth is refused and sends nothing

### Steps
1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]
2. Click [user.sign-in.resend-button] three times, each time once it is enabled again
3. Click [user.sign-in.resend-button] once more

### Expected result
- After step 1 [mail:sign-up] reaches the email
- After step 2 [user.sign-in.mail-message] carries [code:check-your-mail], no [user.sign-in.error] shows, and three [mail:resend-verification] reach the email
- After step 3 [user.sign-in.error] carries [code:rate-limited], no [user.sign-in.mail-message] shows, [user.sign-in.resend-button] shows, and no fourth [mail:resend-verification] reaches the email
