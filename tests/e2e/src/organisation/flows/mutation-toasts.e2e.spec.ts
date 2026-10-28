// scenario: organisation/flows/mutation-toasts
import { generate } from '../../support/data'
import { expect, notice, signUp, test, toast } from '../../support/fixtures'
import { createOrganisation, noteItem } from '../../support/organisation'

test.describe('Say what a change did in a toast', { tag: '@full' }, () => {
  test('An administrator sees a toast for each note added, edited and deleted, and none for a saved profile', async ({
    page,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      firstNote: generate.noteText(),
      secondNote: generate.noteText(),
      editedNote: generate.noteText(),
      newName: generate.newName(),
    }

    await test.step('1. On device A, sign up as user A, open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await createOrganisation(page, data)
      // Expected: After step 1 device A shows [app-shell.toast] carrying
      //   [code:organisation-created]
      await expect(toast(page, 'organisation-created')).toBeVisible()
    })

    await test.step('2. On device A, enter the first note into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.firstNote)
      await page.getByTestId('organisation.notes.add-button').click()
      // Expected: After step 2 device A shows [app-shell.toast] carrying [code:note-created]
      await expect(toast(page, 'note-created')).toHaveCount(1)
    })

    await test.step('3. On device A, enter the second note into [organisation.notes.new-textarea] and click [organisation.notes.add-button] at once', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.secondNote)
      await page.getByTestId('organisation.notes.add-button').click()
      // Expected: After step 3 device A shows two [app-shell.toast] carrying [code:note-created],
      //   the newer one at the top
      await expect(toast(page, 'note-created')).toHaveCount(2)
    })

    await test.step('4. On device A, wait ten seconds', async () => {
      // Expected: After step 4 device A shows no [app-shell.toast], and
      //   [app-shell.notice-message] still carries [code:welcome]
      await expect(page.getByTestId('app-shell.toast')).toHaveCount(0, { timeout: 10_000 })
      await expect(notice(page, 'welcome')).toBeVisible()
    })

    await test.step('5. On device A, click [organisation.notes.edit-button] on the first note, enter the edited note into [organisation.notes.edit-textarea] and click [organisation.notes.save-button]', async () => {
      await noteItem(page, data.firstNote).getByTestId('organisation.notes.edit-button').click()
      await page.getByTestId('organisation.notes.edit-textarea').fill(data.editedNote)
      await page.getByTestId('organisation.notes.save-button').click()
      // Expected: After step 5 device A shows [app-shell.toast] carrying [code:note-updated]
      await expect(toast(page, 'note-updated')).toBeVisible()
    })

    await test.step('6. On device A, click [organisation.notes.delete-button] on the second note', async () => {
      await noteItem(page, data.secondNote).getByTestId('organisation.notes.delete-button').click()
      // Expected: After step 6 device A shows [app-shell.toast] carrying [code:note-deleted]
      await expect(toast(page, 'note-deleted')).toBeVisible()
    })

    await test.step('7. On device A, wait until no [app-shell.toast] shows, open [/me], enter the new name into [user.profile.name-input] and click [user.profile.save-button]', async () => {
      await expect(page.getByTestId('app-shell.toast')).toHaveCount(0, { timeout: 10_000 })
      await page.getByTestId('app-shell.nav.profile-link').click()
      await page.getByTestId('user.profile.name-input').fill(data.newName)
      await page.getByTestId('user.profile.save-button').click()
      // Expected: After step 7 device A shows [app-shell.notice-message] carrying
      //   [code:profile-saved] and no [app-shell.toast]; a toast would come with the notice,
      //   from the same outcome, so its absence is read once the notice shows.
      await expect(notice(page, 'profile-saved')).toBeVisible()
      await expect(page.getByTestId('app-shell.toast')).toHaveCount(0)
    })
  })
})
