/** The attribute that marks the anchor of a mail's primary action: its button. */
export const ACTION_ATTRIBUTE = 'data-mail-action'

/** The value of `ACTION_ATTRIBUTE` on a mail's primary action. */
export const PRIMARY_ACTION = 'primary'

/**
 * What a template spreads on its button to mark it as the mail's primary action: the render
 * boundary holds that one anchor to the mail's link, so a button that lost or changed its href
 * fails the render even while the raw link below it is right.
 */
export const primaryAction = { [ACTION_ATTRIBUTE]: PRIMARY_ACTION } as const
