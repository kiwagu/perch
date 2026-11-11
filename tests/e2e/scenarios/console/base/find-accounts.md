---
tags:
  - full
devices:
  A: operator
  B: guest
data:
  Operator email: generate
  Operator name: generate
  Email prefix: generate
  Password: generate
  Name: generate
---
# Find accounts and page through them

Where: [/console/users] on device A, an operator; device B, another browser, makes the accounts

## Scenario: The operator finds eleven accounts by a part of their email, pages through them ten at a time, and sees them all at once with a larger page

### Steps
1. On device A, sign up with the operator email, the password and the operator name, open the link of [mail:sign-up] and wait for [/me]; then the host's command grants device A's account the operator role, as an operator is appointed, and device A reloads the page
2. On device B, sign up user 1 to user 11 in that order, each with an email that starts with the email prefix, the password and the name, without opening their links
3. On device A, open [/console/users], enter the email prefix into [console.users.search-input] and click [console.users.search-button]
4. On device A, in [console.users.list.size-select] choose [value:10]
5. On device A, click [console.users.list.next-link]
6. On device A, reload the page
7. On device A, click [console.users.list.previous-link]
8. On device A, in [console.users.list.size-select] choose [value:25]
9. On device A, clear [console.users.search-input] and click [console.users.search-button]
10. On device A, enter the operator email into [console.users.search-input] and click [console.users.search-button]

### Expected result
- After step 1 [app-shell.nav] on device A shows [app-shell.nav.console-link]
- After step 3 the URL is [/console/users] with the email prefix as its search, [console.users.list] is in [state:ready] and holds eleven [console.users.list.account-item], the newest first, user 11's at the top, each with its [console.users.list.email-cell], its [console.users.list.name-cell] showing the name, no [console.users.list.verified-badge] and no [console.users.list.banned-badge]; [console.users.list.range] says 1-11 of 11, and neither [console.users.list.previous-link] nor [console.users.list.next-link] shows
- After step 4 the URL carries the size 10 and no page, [console.users.list] holds ten [console.users.list.account-item], user 11's to user 2's, [console.users.list.range] says 1-10 of 11, [console.users.list.next-link] shows and [console.users.list.previous-link] does not
- After step 5 the URL carries the size 10 and the page 2, [console.users.list] holds one [console.users.list.account-item], user 1's, [console.users.list.range] says 11-11 of 11, [console.users.list.previous-link] shows and [console.users.list.next-link] does not
- After step 6 the page is the same: one [console.users.list.account-item], user 1's, [console.users.list.range] saying 11-11 of 11, and [console.users.search-input] holding the email prefix
- After step 7 the URL carries the size 10 and no page, and [console.users.list] holds ten [console.users.list.account-item] again
- After step 8 the URL carries the size 25 and no page, and [console.users.list] holds eleven [console.users.list.account-item] with [console.users.list.range] saying 1-11 of 11
- After step 9 the URL carries neither the search nor the page and keeps the size 25; [console.users.list] holds the platform's newest accounts, at least twelve and at most 25, since the stand's other tests sign accounts up too, and [console.users.list.range] counts from 1 to the number it holds
- After step 10 [console.users.list] holds one [console.users.list.account-item], device A's own, with its [console.users.list.operator-badge] and its [console.users.list.verified-badge]
