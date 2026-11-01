---
tags:
  - smoke
devices:
  A: identity
data:
  Unknown address: /no-such-page
---
# Open an address no page has

Where: [/$] for a guest, then for a signed-in account

## Scenario: A guest and then a signed-in account open an address no page has, and each gets its own way back

### Steps
1. Open the unknown address and wait for [app-shell.status] to reach [state:ready]
2. Click [not-found.page.sign-in-link]
3. Sign up, open the link of [mail:sign-up] and wait for [/me], then open the unknown address again
4. Click [not-found.page.profile-link]

### Expected result
- After step 1 the address is still the unknown address and [not-found.page.heading] shows, with [not-found.page.sign-in-link] and no [not-found.page.profile-link]
- After step 2 the URL is [/sign-in]
- After step 3 [not-found.page.heading] shows, with [not-found.page.profile-link] and no [not-found.page.sign-in-link]
- After step 4 the URL is [/me]
