import { CREATE_REFUSED, ORGANISATION_CREATED } from './effects'
import { taken } from './events'

/**
 * The region of the screen's flow that creates an organisation: the form is closed until its
 * toggle opens it (without a membership it is shown regardless, so its submit is taken closed
 * too), a creation starts every area afresh, a refusal keeps the form open with what was typed.
 */
export const CREATE_FORM_REGION = {
  initial: 'closed',
  states: {
    closed: {
      on: {
        'organisation.create.toggle-button': { target: 'open' },
        'organisation.create.submit-button': { target: 'submitting' },
      },
    },
    open: {
      on: {
        'organisation.create.toggle-button': { target: 'closed' },
        'organisation.create.submit-button': { target: 'submitting' },
      },
    },
    submitting: {
      invoke: {
        src: 'platform.organisations.create',
        input: taken('organisation.create.submit-button'),
        onDone: { target: '#organisation.viewing', actions: [ORGANISATION_CREATED] },
        onError: { target: 'open', actions: [CREATE_REFUSED] },
      },
    },
  },
} as const
