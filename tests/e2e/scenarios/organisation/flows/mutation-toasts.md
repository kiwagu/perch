---
tags:
  - full
devices:
  A: admin
data:
  Organisation key: generate
  Organisation name: generate
  First note: generate
  Second note: generate
  Edited note: generate
  New name: generate
  Bio: generate
---
# Say what a change did in a toast

Where: [/org] and [/me] on device A (user A)

## Scenario: An administrator sees a toast for each note added, edited and deleted, and one for a profile saved in two writes

### Steps
1. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
2. On device A, enter the first note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
3. On device A, enter the second note into [organisation.notes.new-textarea] and click [organisation.notes.add-button] at once
4. On device A, wait ten seconds
5. On device A, click [organisation.notes.edit-button] on the first note, enter the edited note into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]
6. On device A, click [organisation.notes.delete-button] on the second note and answer [app-shell.confirmation.cancel-button]
7. On device A, click [organisation.notes.delete-button] on the second note again and confirm with [app-shell.confirmation.confirm-button]
8. On device A, wait until no [app-shell.toast] shows, open [/me], enter the new name into [user.profile.name-input] and the bio into [user.profile.bio-textarea], and click [user.profile.save-button]

### Expected result
- After step 1 device A shows [app-shell.toast] carrying [code:organisation-created]
- After step 2 device A shows [app-shell.toast] carrying [code:note-created]
- After step 3 device A shows two [app-shell.toast] carrying [code:note-created], the newer one at the top
- After step 4 device A shows no [app-shell.toast], and [app-shell.notice-message] still carries [code:welcome]
- After step 5 device A shows [app-shell.toast] carrying [code:note-updated]
- In step 6 device A shows [app-shell.confirmation] carrying [code:note-delete]; after the answer the second note is still in [organisation.notes.list]
- After step 7 device A shows [app-shell.toast] carrying [code:note-deleted]
- After step 8 device A shows one [app-shell.toast], carrying [code:profile-saved]: the Save wrote the name and the bio and says it once; [app-shell.notice-message] still carries [code:welcome]
