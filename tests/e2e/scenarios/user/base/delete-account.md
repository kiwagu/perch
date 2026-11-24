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
# Delete the account

Where: [/settings], the form [user.settings.deletion.form], then [/delete-account] from [mail:request-account-deletion]

## Scenario: The account goes once the button of the page the mail's link opens is pressed; the old password no longer signs in, and the email signs up again

### Steps
1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]
2. Enter the password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]
3. Open the link of [mail:request-account-deletion]
4. Click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]
5. Click [user.delete-account.sign-in-link], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]
6. Sign up with the email, the password and the name

### Expected result
- After step 2 [user.settings.deletion.message] carries [code:check-your-mail], [user.settings.deletion.password-input] is empty, and [mail:request-account-deletion] reaches the email
- After step 3 the link opens [/delete-account] with [user.delete-account.delete-button]
- At step 4 [app-shell.confirmation] carries [code:delete-account]; after it [user.delete-account.message] carries [code:account-deleted], [user.delete-account.sign-in-link] shows, and [notice:delete-account.account-deleted] reaches the email
- After step 5 [user.sign-in.error] carries [code:invalid-credentials]
- After step 6 [user.sign-in.mail-message] carries [code:check-your-mail] and [mail:sign-up] reaches the email
