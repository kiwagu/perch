// scenario: organisation/flows/shared-notes
import { generate } from '../../support/data'
import { expect, pageLoads, signUp, test, toast } from '../../support/fixtures'
import { createOrganisation, inviteMember } from '../../support/organisation'

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
    const userB = anotherAccount.account

    const deviceB =
      await test.step('1. On device B, sign up as user B, open the link of its [mail:sign-up] and wait for [/me]', async () => {
        const b = await anotherAccount.signUp()

        await expect(b.getByTestId('user.profile.heading')).toHaveText(userB.name)

        return b
      })
    // Full page loads of device B from here: the organisation must reach it without one.
    const loadsOfB = pageLoads(deviceB)

    const { userA, loadsOfA } =
      await test.step('2. On device A, sign up as user A, open the link of its [mail:sign-up], open [/org], enter the key and the name into [organisation.create.key-input] and [organisation.create.name-input] and click [organisation.create.submit-button]', async () => {
        const account = await signUp(page)
        // Full page loads of device A from here: B's note must reach it without one.
        const loads = pageLoads(page)

        await page.getByTestId('app-shell.nav.organisation-link').click()
        // Expected: After step 2 device A shows the organisation name in
        //   [organisation.page.heading] and [organisation.page.role-badge] with [value:admin]
        await createOrganisation(page, data)

        return { userA: account, loadsOfA: loads }
      })

    await test.step('3. On device A, enter the email of user B into [organisation.invite.email-input] and click [organisation.invite.submit-button]', async () => {
      // Expected: After step 3 device A shows [app-shell.toast] carrying [code:invited]
      //   and user B in [organisation.members.list]
      await inviteMember(page, userB.email)
    })

    await test.step('4. On device A, enter the note by A into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
      await page.getByTestId('organisation.notes.new-textarea').fill(data.noteByA)
      await page.getByTestId('organisation.notes.add-button').click()
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA])
    })

    await test.step('5. On device A, open [/me], enter the bio of A into [user.profile.bio-textarea], click [user.profile.save-button] and open [/org] again', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expect(page.getByTestId('user.profile.heading')).toHaveText(userA.name)
      await page.getByTestId('user.profile.bio-textarea').fill(data.bioOfA)
      await page.getByTestId('user.profile.save-button').click()
      await expect(toast(page, 'profile-saved')).toBeVisible()
      await page.getByTestId('app-shell.nav.organisation-link').click()
      await expect(
        page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA])
    })

    await test.step('6. On device B, open [/org]', async () => {
      await deviceB.getByTestId('app-shell.nav.organisation-link').click()
      // Expected: After step 6 device B shows the organisation name in [organisation.page.heading],
      //   [organisation.page.role-badge] with [value:member] and the note by A in
      //   [organisation.notes.list], without an invitation page or a reload
      await expect(deviceB).toHaveURL(/\/org$/)
      await expect(deviceB.getByTestId('organisation.page.heading')).toHaveText(data.name, {
        timeout: 10_000,
      })
      await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
        'data-value',
        'member',
      )
      await expect(
        deviceB.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
      ).toHaveText([data.noteByA], {
        timeout: 10_000,
      })
      expect(loadsOfB(), 'pages device B loaded since it signed up').toBe(0)
    })

    const measure =
      await test.step('7. On device B, enter the note by B into [organisation.notes.new-textarea] and click [organisation.notes.add-button]', async () => {
        // When device A shows the note by B, read on the clock both browsers share.
        const shownAt = page
          .waitForFunction(
            (text) =>
              Array.from(
                document.querySelectorAll('[data-testid="organisation.notes.text-cell"]'),
              ).some((node) => node.textContent === text) && Date.now(),
            data.noteByB,
            { polling: 'raf', timeout: 5_000 },
          )
          .then((handle) => handle.jsonValue())

        // Awaited after the assertion below, which reports a timeout better.
        shownAt.catch(() => undefined)
        await deviceB.getByTestId('organisation.notes.new-textarea').fill(data.noteByB)

        const clickedAt = Date.now()

        await deviceB.getByTestId('organisation.notes.add-button').click()
        await expect(
          deviceB
            .getByTestId('organisation.notes.list')
            .getByTestId('organisation.notes.text-cell')
            .filter({ hasText: data.noteByB }),
        ).toBeVisible()

        return { clickedAt, shownAt }
      })

    // Expected:
    // - Within 5 seconds of step 7 device A shows the note by B in [organisation.notes.list],
    //   without a reload; the delay is reported as "note-sync-latency-ms"
    await expect(
      page.getByTestId('organisation.notes.list').getByTestId('organisation.notes.text-cell'),
    ).toHaveText([data.noteByA, data.noteByB], { timeout: 5_000 })

    const shownAt = await measure.shownAt
    const latency = typeof shownAt === 'number' ? shownAt - measure.clickedAt : Number.NaN

    expect(latency, 'the delay from the click to the note on device A').toBeGreaterThanOrEqual(0)
    expect(latency, 'the delay from the click to the note on device A').toBeLessThanOrEqual(5_000)
    expect(loadsOfA(), 'pages device A loaded since it signed up').toBe(0)
    testInfo.annotations.push({ type: 'note-sync-latency-ms', description: String(latency) })
    // - Device B shows no [organisation.members.list] and no [organisation.invite.form]
    await expect(deviceB.getByTestId('organisation.page.role-badge')).toHaveAttribute(
      'data-value',
      'member',
    )
    await expect(deviceB.getByTestId('organisation.members.list')).toHaveCount(0)
    await expect(deviceB.getByTestId('organisation.invite.form')).toHaveCount(0)
    // - Device B shows nothing of user A's profile: its [/me] shows user B's own name in
    //   [user.profile.heading] and an empty [user.profile.bio-textarea]
    await deviceB.getByTestId('app-shell.nav.profile-link').click()
    await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(userB.name)
    await expect(deviceB.getByTestId('user.profile.bio-textarea')).toHaveValue('')
  })
})
