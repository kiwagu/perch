// spec: tests/e2e/specs/organisation/02-outsider.md
import { generate } from '../support/data'
import { expect, signUp, test } from '../support/fixtures'

test.describe('Keep an organisation invisible to accounts outside it', { tag: '@full' }, () => {
  test('An account that was not invited sees no organisation and no notes', async ({
    page,
    anotherAccount,
  }) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
      keyOfC: generate.tenantKey(),
      nameOfC: generate.organisationName(),
    }
    const deviceC = anotherAccount.page

    await test.step('1. On device A, sign up as user A, open "/org", create the organisation and add the note by A', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.organisation').click()
      await page.getByTestId('organisation.create.key').fill(data.key)
      await page.getByTestId('organisation.create.name').fill(data.name)
      await page.getByTestId('organisation.create.submit').click()
      await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
      await page.getByTestId('organisation.notes.input').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add').click()
      await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
    })

    await test.step('2. On device C, sign up as user C and open "/org"', async () => {
      // The fixture signed user C up through the sign-in page in a browser of its own.
      await expect(deviceC).toHaveURL(/\/me$/)
      await deviceC.getByTestId('app-shell.nav.organisation').click()
      // Expected: after step 2 device C shows "You are not a member of any organisation yet."
      // and no notes
      await expect(deviceC.getByTestId('organisation.none')).toHaveText(
        'You are not a member of any organisation yet.',
      )
      await expect(deviceC.getByTestId('organisation.notes.item')).toHaveCount(0)
    })

    await test.step("3. On device C, create C's own organisation", async () => {
      await deviceC.getByTestId('organisation.create.key').fill(data.keyOfC)
      await deviceC.getByTestId('organisation.create.name').fill(data.nameOfC)
      await deviceC.getByTestId('organisation.create.submit').click()
      // Expected: after step 3 device C shows C's organisation with no notes, and no selector
      // for another organisation
      await expect(deviceC.getByTestId('organisation.heading')).toHaveText(data.nameOfC)
      // The notes of C's organisation have been read: the list says it is empty.
      await expect(deviceC.getByText('No notes yet.')).toBeVisible()
      await expect(deviceC.getByTestId('organisation.notes.item')).toHaveCount(0)
      await expect(deviceC.getByTestId('organisation.select')).toHaveCount(0)
    })

    // Expected:
    // - Device A still shows only its own organisation and the note by A
    await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
    await expect(page.getByTestId('organisation.select')).toHaveCount(0)
    await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
  })
})
