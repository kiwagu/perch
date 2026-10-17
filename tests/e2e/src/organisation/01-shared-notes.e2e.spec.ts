// spec: tests/e2e/specs/organisation/01-shared-notes.md
import { generate } from '../support/data'
import { expect, signUp, test } from '../support/fixtures'

test.describe('Share notes inside an organisation and keep private data private', {
  tag: '@full',
}, () => {
  test("Two members of one organisation see each other's notes and nothing private", async ({
    page,
    anotherAccount,
  }, testInfo) => {
    const data = {
      key: generate.tenantKey(),
      name: generate.organisationName(),
      noteByA: generate.noteText(),
      noteByB: generate.noteText(),
      bioOfA: generate.bio(),
    }
    const { account: userB, page: deviceB } = anotherAccount
    // Full page loads of device B: the organisation must reach it without one.
    let loadsOfB = 0

    deviceB.on('load', () => {
      loadsOfB += 1
    })

    await test.step('1. On device B, sign up as user B and wait for "/me"', async () => {
      // The fixture signed user B up through the sign-in page in a browser of its own.
      await expect(deviceB).toHaveURL(/\/me$/)
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(userB.name)
    })

    const userA =
      await test.step('2. On device A, sign up as user A, open "/org", enter the key and the name and click "Create"', async () => {
        const account = await signUp(page)

        await page.getByTestId('app-shell.nav.organisation').click()
        await page.getByTestId('organisation.create.key').fill(data.key)
        await page.getByTestId('organisation.create.name').fill(data.name)
        await page.getByTestId('organisation.create.submit').click()
        // Expected: after step 2 device A shows the organisation name in the heading and the
        // role "Administrator"
        await expect(page.getByTestId('organisation.heading')).toHaveText(data.name)
        await expect(page.getByTestId('organisation.role')).toHaveText('Administrator')

        return account
      })

    await test.step('3. On device A, enter the email of user B and click "Invite"', async () => {
      await page.getByTestId('organisation.invite.email').fill(userB.email)
      await page.getByTestId('organisation.invite.submit').click()
      // Expected: after step 3 device A shows the notification "Invited" and user B in the
      // members list
      await expect(page.getByTestId('organisation.invite.notice')).toHaveText('Invited')
      await expect(
        page.getByTestId('organisation.members.item').filter({ hasText: userB.email }),
      ).toBeVisible()
    })

    await test.step('4. On device A, enter the note by A and click "Add note"', async () => {
      await page.getByTestId('organisation.notes.input').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add').click()
      await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])
    })

    await test.step('5. On device A, open "/me", enter the bio of A and click "Save"', async () => {
      await page.getByTestId('app-shell.nav.profile').click()
      await expect(page.getByTestId('user.profile.heading')).toHaveText(userA.name)
      await page.getByTestId('user.profile.bio-input').fill(data.bioOfA)
      await page.getByTestId('user.profile.save').click()
      await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
    })

    await test.step('6. On device B, open "/org"', async () => {
      await deviceB.getByTestId('app-shell.nav.organisation').click()
      // Expected: after step 6 device B shows the organisation name, the role "Member" and the
      // note by A, without an invitation page or a reload
      await expect(deviceB).toHaveURL(/\/org$/)
      await expect(deviceB.getByTestId('organisation.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
      await expect(deviceB.getByTestId('organisation.role')).toHaveText('Member')
      await expect(deviceB.getByTestId('organisation.notes.text')).toHaveText([data.noteByA], {
        timeout: 10_000,
      })
      expect(loadsOfB, 'pages device B loaded since it signed up').toBe(0)
    })

    const measure =
      await test.step('7. On device B, enter the note by B and click "Add note"', async () => {
        // Device A left the organisation for "/me" in step 5: it comes back through the
        // navigation, not a reload, to show what arrives.
        await page.getByTestId('app-shell.nav.organisation').click()
        await expect(page.getByTestId('organisation.notes.text')).toHaveText([data.noteByA])

        // When device A shows the note by B, read on the clock both browsers share.
        const shownAt = page
          .waitForFunction(
            (text) =>
              Array.from(document.querySelectorAll('[data-testid="organisation.notes.text"]')).some(
                (node) => node.textContent === text,
              ) && Date.now(),
            data.noteByB,
            { polling: 'raf', timeout: 5_000 },
          )
          .then((handle) => handle.jsonValue())

        // Awaited after the assertion below, which reports a timeout better.
        shownAt.catch(() => undefined)
        await deviceB.getByTestId('organisation.notes.input').fill(data.noteByB)

        const clickedAt = Date.now()

        await deviceB.getByTestId('organisation.notes.add').click()
        await expect(
          deviceB.getByTestId('organisation.notes.text').filter({ hasText: data.noteByB }),
        ).toBeVisible()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 7 device A shows the note by B, without a reload; the delay is reported as "note-sync-latency-ms"
    await expect(page.getByTestId('organisation.notes.text')).toHaveText(
      [data.noteByA, data.noteByB],
      { timeout: 5_000 },
    )

    const shownAt = await measure.shownAt
    const latency = typeof shownAt === 'number' ? shownAt - measure.clickedAt : Number.NaN

    expect(latency, 'the delay from the click to the note on device A').toBeGreaterThanOrEqual(0)
    expect(latency, 'the delay from the click to the note on device A').toBeLessThanOrEqual(5_000)
    testInfo.annotations.push({ type: 'note-sync-latency-ms', description: String(latency) })
    // - Device B shows no members list and no invite form
    await expect(deviceB.getByTestId('organisation.role')).toHaveText('Member')
    await expect(deviceB.getByTestId('organisation.members.list')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.invite.email')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.invite.submit')).toHaveCount(0)
    // - Device B shows nothing of user A's profile: its "/me" shows user B's own name and an empty bio
    await deviceB.getByTestId('app-shell.nav.profile').click()
    await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(userB.name)
    await expect(deviceB.getByTestId('user.profile.bio-input')).toHaveValue('')
  })
})
