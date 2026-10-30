import { expect, type Page } from '@playwright/test'

import { toast } from './fixtures'

/** The item of the note whose text holds `text`. */
export const noteItem = (device: Page, text: string) =>
  device.getByTestId('organisation.notes.item').filter({ hasText: text })

/**
 * Creates the organisation from the open "/org" page: the heading then names it and the role
 * badge says the creator administers it.
 */
export async function createOrganisation(
  page: Page,
  organisation: { readonly key: string; readonly name: string },
): Promise<void> {
  await page.getByTestId('organisation.create.key-input').fill(organisation.key)
  await page.getByTestId('organisation.create.name-input').fill(organisation.name)
  await page.getByTestId('organisation.create.submit-button').click()
  await expect(page.getByTestId('organisation.page.heading')).toHaveText(organisation.name)
  await expect(page.getByTestId('organisation.page.role-badge')).toHaveAttribute(
    'data-value',
    'admin',
  )
}

/** The administrator's page after an invitation of `email`: the toast `invited` and the account in the members list. */
export async function expectInvited(page: Page, email: string): Promise<void> {
  await expect(toast(page, 'invited')).toBeVisible()
  await expect(
    page
      .getByTestId('organisation.members.list')
      .getByTestId('organisation.members.item')
      .filter({ hasText: email }),
  ).toBeVisible()
}

/** Invites the account at `email` from the open "/org" page of an administrator. */
export async function inviteMember(page: Page, email: string): Promise<void> {
  await page.getByTestId('organisation.invite.email-input').fill(email)
  await page.getByTestId('organisation.invite.submit-button').click()
  await expectInvited(page, email)
}
