---
tags:
  - smoke
devices:
  A: admin
data:
  Invalid key: Not a key
  Organisation key: generate
  Organisation name: generate
---
# Create the first organisation

Where: [/org] without a membership, then [organisation.create.submit-button]

## Scenario: An account that belongs to no organisation creates one and administers it

### Steps
1. Sign up, open [/org] and wait for [organisation.page.status] to reach [state:empty]
2. Enter the invalid key and the organisation name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. Clear [organisation.create.key-input], enter the organisation key into it and click [organisation.create.submit-button]
4. Reload the page and wait for [app-shell.status] to reach [state:ready]

### Expected result
- After step 1 [organisation.create.form] shows, with no [organisation.create.toggle-button], no [organisation.page.heading] and no [organisation.notes.section]
- After step 2 [organisation.create.error] carries [code:key-invalid], [organisation.page.status] is still in [state:empty] and [organisation.create.name-input] keeps the organisation name
- After step 3 [app-shell.toast] carries [code:organisation-created], [organisation.page.heading] shows the organisation name, [organisation.page.role-badge] carries [value:admin] and no [organisation.page.status] shows
- After step 3 [organisation.notes.section] reaches [state:empty] with [organisation.notes.empty-message] carrying [code:no-notes], [organisation.members.list] holds one [organisation.members.item], the account's own, without [organisation.members.remove-button], and [organisation.invite.form] shows
- After step 3 [organisation.create.form] is closed behind [organisation.create.toggle-button], and no [organisation.page.current-select] shows for one organisation
- After step 4 [organisation.page.heading] shows the organisation name, [organisation.page.role-badge] carries [value:admin] and [organisation.notes.section] is in [state:empty]
