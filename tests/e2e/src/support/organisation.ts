import { expect, type Page } from '@playwright/test'

/**
 * Creates the organisation from the open "/org" page: the heading then names it and the role
 * reads "Administrator".
 */
export async function createOrganisation(
  page: Page,
  organisation: { readonly key: string; readonly name: string },
): Promise<void> {
  await page.getByTestId('organisation.create.key').fill(organisation.key)
  await page.getByTestId('organisation.create.name').fill(organisation.name)
  await page.getByTestId('organisation.create.submit').click()
  await expect(page.getByTestId('organisation.heading')).toHaveText(organisation.name)
  await expect(page.getByTestId('organisation.role')).toHaveText('Administrator')
}

/** The administrator's page after an invitation of `email`: the notice "Invited" and the account in the members list. */
export async function expectInvited(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId('organisation.invite.notice')).toHaveText('Invited')
  await expect(
    page.getByTestId('organisation.members.item').filter({ hasText: email }),
  ).toBeVisible()
}

/** Invites the account at `email` from the open "/org" page of an administrator. */
export async function inviteMember(page: Page, email: string): Promise<void> {
  await page.getByTestId('organisation.invite.email').fill(email)
  await page.getByTestId('organisation.invite.submit').click()
  await expectInvited(page, email)
}
