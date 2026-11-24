---
tags:
  - full
devices:
  A: admin
  B: member
  C: identity
data:
  Organisation key: generate
  Organisation name: generate
  Invited email: generate
  Second invited email: generate
  Password: generate
  Name: generate
---
# An invited account starts in its organisation's default language

Where: [/org] on device A (user A, admin, in English); [/sign-in], then [/settings] and [/org], on devices B and C (two other browsers, in English)

## Scenario: An admin sets the organisation's default language; an account its invitation creates starts in it, the member's own choice wins afterwards, and once the admin removes it a new account starts in its sign-up's language

### Steps
1. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
2. On device A, wait for [organisation.settings.locale-select] to be enabled, in [organisation.settings.locale-select] choose [value:es], wait for it to show [value:es], then for [app-shell.sync-message] to carry [code:synced]
3. On device A, enter the invited email into [organisation.invite.email-input], click [organisation.invite.submit-button] and wait for [app-shell.toast] to carry [code:invited]
4. On device B, open [/sign-in], sign up with the invited email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]
5. On device B, open [/org] and click [organisation.received.accept-button] on the organisation's [organisation.received.item]
6. On device B, click [app-shell.nav.settings-link], in [user.settings.locale-select] choose [value:en], then reload the page and wait for [user.settings.locale-select] to be enabled
7. On device A, reload [/org]
8. On device A, click [organisation.settings.clear-button], wait for it to be gone, then for [app-shell.sync-message] to carry [code:synced]
9. On device A, enter the second invited email into [organisation.invite.email-input], click [organisation.invite.submit-button] and wait for [app-shell.toast] to carry [code:invited]
10. On device C, open [/sign-in], sign up with the second invited email, the password and the name, open the link of [mail:sign-up] and click [app-shell.nav.settings-link]

### Expected result
- After step 2 [organisation.settings.locale-select] shows [value:es] on device A, the change has reached the server, and no [app-shell.notice-message] carries [code:change-rejected]
- After step 3 the invitation is pending, and [mail:organisations.invite] reaches the invited email in the language [value:en], user A's, as no account has that email yet
- After step 4 [mail:sign-up] reaches the invited email in the language [value:es], the organisation's, though the sign-up page spoke English, and [user.settings.locale-select] shows [value:es]
- After step 5 device B shows [organisation.page.role-badge] carrying [value:member] and no [organisation.settings.locale-select]
- After step 6 [user.settings.locale-select] still shows [value:en]: the member's own language wins over the organisation's
- After step 7 [organisation.settings.locale-select] still shows [value:es] on device A, with [organisation.settings.clear-button] beside it
- After step 8 [organisation.settings.clear-button] is gone on device A, the removal has reached the server, and no [app-shell.notice-message] carries [code:change-rejected]
- After step 10 [mail:sign-up] reaches the second invited email in the language [value:en] and [user.settings.locale-select] shows [value:en] on device C: with no default, the account starts in its sign-up page's language
