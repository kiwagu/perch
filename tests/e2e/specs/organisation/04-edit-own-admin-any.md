# Edit only your own notes; an administrator edits any

Role: user
Where: "/org" on device A (user A, administrator) and "/org" on device B (user B, member, another browser)

## Test data
- Organisation key: generate
- Organisation name: generate
- Note by A: generate
- Note by B: generate
- Note by B, edited by B: generate
- Note by B, edited by A: generate

## Scenario: A member changes only its own notes, an administrator any, and both see every change

### Steps
1. On device B, sign up as user B and wait for "/me"
2. On device A, sign up as user A, open "/org", enter the key and the name and click "Create"
3. On device A, enter the email of user B and click "Invite"
4. On device A, enter the note by A and click "Add note"
5. On device B, open "/org"
6. On device B, enter the note by B and click "Add note"
7. On device B, click "Edit" on the note by B, enter the note by B edited by B and click "Save"
8. On device A, click "Edit" on the note by B, enter the note by B edited by A and click "Save"
9. On device B, click "Delete" on the note by B
10. On device A, click "Delete" on the note by A

### Expected result
- After step 5 device B shows the note by A without "Yours", "Edit" or "Delete"
- After step 6 device B shows the note by B with "Yours", "Edit" and "Delete"
- Within 5 seconds of step 7 device A shows the note by B edited by B, without a reload; the delay is reported as "note-edit-sync-latency-ms"
- Device A shows "Edit" and "Delete" on both notes
- Within 5 seconds of step 8 device B shows the note by B edited by A, without a reload
- Within 5 seconds of step 9 device A shows only the note by A
- After step 10 both devices show "No notes yet."
- Neither device loaded a page since it signed up
