---
tags:
  - smoke
devices:
  A: identity
  B: guest
data:
  Email: generate
  Password: generate
  Name: generate
---
# Open the console without the operator role

Where: [/console/users] on device A, a signed-in account that is no operator, and on device B, a guest

## Scenario: An account without the operator role and a guest each get the not-found page at the console's addresses, which reveal nothing, and the navigation shows no console link

### Steps
1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]
2. On device A, open [/console/users]
3. On device A, open [/console/account] with any id as its search
4. On device B, open [/console/users]

### Expected result
- After step 1 [app-shell.nav] on device A shows no [app-shell.nav.console-link]
- After step 2 the address is still [/console/users], [not-found.page.heading] shows with [not-found.page.profile-link], no [console.users.list] and no [console.users.search-form] shows, and the page's title is the not-found page's
- After step 3 the address is still [/console/account] with its search, and [not-found.page.heading] shows
- After step 4 the address is still [/console/users] on device B, [not-found.page.heading] shows with [not-found.page.sign-in-link], and device B is not sent to [/sign-in]
