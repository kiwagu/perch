---
tags:
  - full
devices:
  A: operator
  B: guest
data:
  Email prefix: generate
  Password: generate
  Name: generate
---
# Find accounts and page through them

Where: [/console/users] on device A, an operator; device B, another browser, makes the accounts

## Scenario: The operator finds eleven accounts by a part of their email, pages through them ten at a time, and sees them all at once with a larger page

### Steps
1. On device B, sign up user 1 to user 11 in that order, each with an email that starts with the email prefix, the password and the name, without opening their links
2. On device A, open [/console/users], enter the email prefix into [console.users.search-input] and click [console.users.search-button]
3. On device A, choose [value:10] in [console.users.list.size-select]
4. On device A, click [console.users.list.next-link]
5. On device A, reload the page
6. On device A, click [console.users.list.previous-link]
7. On device A, choose [value:25] in [console.users.list.size-select]
8. On device A, clear [console.users.search-input] and click [console.users.search-button]

### Expected result
- After step 2 the URL is [/console/users] with the email prefix as its search, [console.users.list] is in [state:ready] and holds eleven [console.users.list.account-item], the newest first, user 11's at the top, each with its [console.users.list.email-cell], its [console.users.list.name-cell] showing the name, no [console.users.list.verified-badge] and no [console.users.list.banned-badge]; [console.users.list.range] says 1-11 of 11, and neither [console.users.list.previous-link] nor [console.users.list.next-link] shows
- After step 3 the URL carries the size 10 and no page, [console.users.list] holds ten [console.users.list.account-item], user 11's to user 2's, [console.users.list.range] says 1-10 of 11, [console.users.list.next-link] shows and [console.users.list.previous-link] does not
- After step 4 the URL carries the size 10 and the page 2, [console.users.list] holds one [console.users.list.account-item], user 1's, [console.users.list.range] says 11-11 of 11, [console.users.list.previous-link] shows and [console.users.list.next-link] does not
- After step 5 the page is the same: one [console.users.list.account-item], user 1's, [console.users.list.range] saying 11-11 of 11, and [console.users.search-input] holding the email prefix
- After step 6 the URL carries the size 10 and no page, and [console.users.list] holds ten [console.users.list.account-item] again
- After step 7 the URL carries the size 25 and no page, and [console.users.list] holds eleven [console.users.list.account-item] with [console.users.list.range] saying 1-11 of 11
- After step 8 the URL carries neither the search nor the page, keeps the size 25, and [console.users.list] holds the eleven accounts and the others of the platform, device A's own account among them with its [console.users.list.operator-badge]
