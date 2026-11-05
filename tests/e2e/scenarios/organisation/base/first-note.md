---
tags:
  - smoke
devices:
  A: admin
data:
  Organisation key: generate
  Organisation name: generate
  Note: generate
---
# Add the first note

Where: [/org] of a new organisation, then [organisation.notes.add-button]

## Scenario: An administrator adds the first note of a new organisation and sees it as its own

### Steps
1. Sign up, open the link of [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
2. Click [organisation.notes.add-button] with [organisation.notes.new-textarea] empty
3. Enter the note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
4. Reload the page and wait for [organisation.notes.section] to reach [state:ready]

### Expected result
- After step 2 [organisation.notes.error] carries [code:text-required] and [organisation.notes.section] is still in [state:empty]
- After step 3 [app-shell.toast] carries [code:note-created], [organisation.notes.new-textarea] is empty and [organisation.notes.section] is in [state:ready], with no [organisation.notes.empty-message]
- After step 3 [organisation.notes.list] holds one [organisation.notes.item]: its [organisation.notes.text-cell] shows the note, with [organisation.notes.mine-badge], [organisation.notes.edit-button] and [organisation.notes.delete-button]
- After step 4 [organisation.notes.list] still holds the one note
