---
tags:
  - full
devices:
  A: admin
  B: member
data:
  Organisation key: generate
  Organisation name: generate
  Note by A: generate
  Note by B: generate
  Note by B, edited by B: generate
  Note by B, edited by A: generate
---
# Edit only your own notes; an administrator edits any

Where: [/org] on device A (user A, administrator) and [/org] on device B (user B, member, another browser)

## Scenario: A member changes only its own notes, an administrator any, and both see every change

### Steps
1. On device B, sign up as user B and wait for [/me]
2. On device A, sign up as user A, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]
3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]
4. On device A, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
5. On device B, open [/org]
6. On device B, enter the note by B into [organisation.notes.new-textarea] and click [organisation.notes.add-button]
7. On device B, click [organisation.notes.edit-button] on the note by B, enter the note by B edited by B into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]
8. On device A, click [organisation.notes.edit-button] on the note by B, enter the note by B edited by A into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]
9. On device B, click [organisation.notes.delete-button] on the note by B
10. On device A, click [organisation.notes.delete-button] on the note by A

### Expected result
- After step 5 device B shows the note by A without [organisation.notes.mine-badge], [organisation.notes.edit-button] or [organisation.notes.delete-button]
- After step 6 device B shows the note by B with [organisation.notes.mine-badge], [organisation.notes.edit-button] and [organisation.notes.delete-button]
- Within 5 seconds of step 7 device A shows the note by B edited by B, without a reload; the delay is reported as "note-edit-sync-latency-ms"
- Device A shows [organisation.notes.edit-button] and [organisation.notes.delete-button] on both notes
- Within 5 seconds of step 8 device B shows the note by B edited by A, without a reload
- Within 5 seconds of step 9 device A shows only the note by A
- After step 10 both devices show [organisation.notes.empty-message]
- Neither device loaded a page since it signed up
