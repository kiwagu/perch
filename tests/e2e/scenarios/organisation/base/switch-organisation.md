---
tags:
  - smoke
devices:
  A: admin
data:
  First key: generate
  First name: generate
  Note: generate
  Second key: generate
  Second name: generate
---
# Create a second organisation and switch between them

Where: [/org] with one organisation, then [organisation.create.toggle-button] and [organisation.page.current-select]

## Scenario: An administrator of one organisation creates a second one, which becomes current, and chooses the first one again

### Steps
1. Sign up, open the link of [mail:sign-up], open [/org], enter the first key and name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
2. Enter the note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
3. Click [organisation.create.toggle-button], enter the second key and name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
4. Choose the option of the first key in [organisation.page.current-select]
5. Reload the page and wait for [app-shell.status] to reach [state:ready]

### Expected result
- After step 3 [organisation.page.heading] shows the second name, [organisation.page.role-badge] carries [value:admin], [organisation.notes.section] reaches [state:empty] and [organisation.create.form] is closed again
- After step 3 [organisation.page.current-select] shows two [organisation.page.current-select.option], one per key
- After step 4 [organisation.page.heading] shows the first name and [organisation.notes.list] holds the note
- After step 5 the first organisation is still current: [organisation.page.heading] shows the first name
