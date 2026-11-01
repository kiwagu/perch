---
tags:
  - full
devices:
  A: admin
  C: identity
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
  Key of C's organisation: generate
  Name of C's organisation: generate
---
# Keep an organisation invisible to accounts outside it

Where: [/org] on device A (user A) and [/org] on device C (user C, another browser)

## Scenario: An account that was not invited sees no organisation and no notes

### Steps
1. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], create the organisation with [organisation.create.submit-button] and add the note by A with [organisation.notes.add-button]
2. On device C, sign up as user C, open the link of its [mail:sign-up] and open [/org]
3. On device C, create C's own organisation with [organisation.create.submit-button]

### Expected result
- After step 2 device C shows [organisation.page.status] in [state:empty] (not a member of any organisation yet) and no [organisation.notes.item]
- After step 3 device C shows C's organisation in [organisation.page.heading] with no [organisation.notes.item], and no [organisation.page.current-select] for another organisation
- Device A still shows only its own organisation and the note by A in [organisation.notes.list]
