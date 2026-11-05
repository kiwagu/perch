---
tags:
  - smoke
devices:
  A: guest
data:
  Email: generate
---
# Ask for a new password for an email that has no account

Where: [/forgot-password], for an email no account has

## Scenario: The page answers an unknown email as it answers one that has an account, and sends no mail

### Steps
1. Open [/forgot-password] and wait for [app-shell.status] to reach [state:ready]
2. Enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]

### Expected result
- After step 2 [user.forgot-password.message] carries [code:check-your-mail], and no [mail:request-password-reset] reaches the email
