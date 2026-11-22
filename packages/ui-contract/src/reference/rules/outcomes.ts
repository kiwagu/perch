/**
 * What a flow leaves out about the outcome of an action: what a failure shows, the outcome of a
 * request, the region of a button, the toast of a success and the question before a destructive
 * action, each derived by the loader the same way every time.
 */

import type { ReferenceRule } from '../rule'

const failureShow: ReferenceRule = {
  id: 'failure-show',
  title: 'What a failure shows',
  text: [
    "In the `onError` of an invoke, `show: <anchor>` shows one of the codes the failure of the invoked action shows. In an `onError` list with a branch guarded by failure code, a bare `show` on that branch shows the guard's codes, and one on a later branch, unguarded or guarded by a sentence, the failure's codes but those the branches guarded by code before it take; a branch before the first one guarded by code shows the whole failure, and a `show` that names its codes keeps them. So where the state `signing-in` of `user.sign-in` writes `show: user.sign-in.error` on both of its branches, with `emailNotVerified: { codes: [ email-not-verified ] }`, the first shows `email-not-verified` and the second `invalid-credentials`, `rate-limited`, `other-account` and `failed`; a screen may write the codes out instead, and what it writes wins. The error's own codes are not narrowed: it carries every code of the failure, whichever branch shows it. A bare `show` after branches guarded by code that take every code of the failure is refused: that branch names the codes it shows.",
  ].join('\n\n'),
  keys: ['screen.flow.states.<name>.on.<name>.guard', 'screen.flow.meta.guards.<name>.codes'],
}

const requestOutcome: ReferenceRule = {
  id: 'request-outcome',
  title: 'The outcome of a request',
  text: [
    "An invoke whose action fails with codes and that writes no `onError` follows the pattern of a request: entering its state clears the error its failure shows on (unless the state's `entry` clears it already), and a failure goes back the one way it came, showing its codes on that error. The way back is the one sibling state whose transitions on controls enter the invoking state: only a control makes one, so a state a platform event or a data event enters has none. The error is `<part>.error` of the part those controls sit in (of the fields the invoke's `input` names, when no control enters it), else `<screen>.error`; with no part at all, no control entering it and its `input` naming no field (a request a link starts, its input a search parameter), it is `<screen>.error`.",
    'So the state `changing` of `user.settings` may leave out its `entry` and its `onError`: the loader clears `user.settings.password.error` on entry and adds the `onError` back to `kept`, the one state whose `user.settings.password.save-button` enters it, showing the failure of `platform.change-password` on that error. An `onError` written as its target alone (a `description` beside it changes nothing) keeps that target and still gets the show, with no clear on entry; one with actions, or a guarded list (the state `resetting` of `user.reset-password`), is written in full and wins.',
    "A state with no single way back writes its `onError`, and the check names the reason when it does not: one where its flow or its region starts (even when a sibling enters it too), one two states enter, one an invoke's outcome enters, one a platform event or a data event enters, one entered from outside its area. So does a state whose failure finds no error, its target alone written or not. A state with no way back may write its `onError` as its target alone, which still gets the show: a request a link starts where its flow starts writes `onError: <state>`, and its failure shows on `<screen>.error`. An action that fails with no code gets nothing.",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.invoke.onError',
    'screen.flow.states.<name>.invoke.onDone',
    'screen.flow.states.<name>.entry',
  ],
}

const buttonRegion: ReferenceRule = {
  id: 'button-region',
  title: 'The region of a button',
  text: [
    "A button bound to one action that no state of the flow handles gets its region, when the root of the flow has one parallel state. The region is named by the button without its screen and its kind (`organisation.notes.add-button` gives `notes-add`) and comes after the regions written; it counts among the two regions or more of the parallel state, which may write fewer. It rests in `idle`; the button moves it to `running`, which invokes the action with the parameters the binding passes, and both outcomes lead back to `idle`. A failure shows its codes on the error of the button's part, which from version 5 a success clears (see the rule `area-request`); the success of an action of the model says what the controls do by the word its name starts with: `create` (`createNote`), the controls whose values it took are emptied; `update`, they show the stored value; `delete`, the entry leaves its list. A failure with codes and no error in the part is a problem: the screen declares the error, or writes the region by its button with its `onError`.",
    "A screen writes the region by its button, `by: <button>`, when it decides something of it: its `description`, `onDone` and `onError`, and the `toast: false` or `read: false` it says of its action, which the loader puts on the region's invoke; a branch of its `onDone` or `onError` that says `read: false` keeps it. An outcome left out is the derived one; a transition without a target goes back to `idle`. The states of a button's region are the machine's, named by the loader (`idle`, `running`), and a scenario or a test reads them as it reads any state.",
    "On `by`: The button whose region this is: a button of the screen bound to one action. The region rests in `idle`, the button moves it to `running`, which invokes the action with the parameters the binding passes, and both outcomes lead back to `idle`. It carries what the screen decides of the button: its `description`, `onDone` and `onError`, and the `toast: false` or `read: false` it says of its action, which the loader puts on the region's invoke; a branch of its `onDone` or `onError` that says `read: false` keeps it. An outcome left out is the derived one.",
  ].join('\n\n'),
  keys: ['screen.flow.states.<name>.states.<name>.by'],
}

const successToast: ReferenceRule = {
  id: 'success-toast',
  title: 'The toast of a success',
  text: [
    "With a toast anchor on the frame (`app-shell.toast`), every mutation says its success there, with a standard message: each invoke of an action of the model, written or in a derived region, gets on each branch of its `onDone` `show: { app-shell.toast: [<code>] }`, the code being the action's object in kebab case and the past of its verb (`note.createNote` gives `note-created`, `profile.updateBio` gives `bio-updated`), or `<action>-done` for a verb other than create, update and delete; a platform action toasts when `platform.yaml` lists it under `toasts`, with the code listed (`organisations.create: organisation-created`), and an unlisted one never does.",
    "The toast says an operation's outcome once, where it ends: an operation starts with an event that enters a state running such an action and goes on along the branches of its `onDone` that enter another (one Save running `updateName`, then `updateBio`); such a step toasts nothing, and a branch that targets its own state re-enters nothing. An operation of one action says that action's code; one of several says the operation, `<object>-<verb>ed` from the control whose event starts it: the verb is the control's name without its kind, in the past (`save-button` gives `saved`), the object the part the control sits in, or the screen's last segment for a control of the screen itself (`user.profile.save-button` gives `profile-saved`). An operation of several that no control starts (a platform event), or that controls with different codes start, is refused until the screen writes its own message on the toast or bans it; so is one event that starts several such operations at once (the regions of a parallel state it enters, or two regions handling one press with transitions that stay in them), until the screen writes `toast: false` on every action of all but one. One press gives one toast.",
    "The toast stays on unless the screen says otherwise: a branch of the `onDone` that shows its own message on the toast keeps it (a written message wins on its anchor, branch by branch; the other branches still get the standard one), and the one ban is `toast: false` on the invoke, or on a region written `by` its button (the language select's store: the change is visible by itself); a notice or an error written on the outcome says nothing about the toast. `read: false` sits beside it on the same invoke or region, a different statement: the action changes nothing a list of the screen shows, so nothing reads after it; on one branch of the `onDone`, nothing reads after that outcome, and the branch keeps its toast (see the rule `read-after-an-action`). A failure never toasts: it shows on the part's error.",
    "The toast anchor carries every code a flow shows on it; the vocabulary documents the derived ones by one rule row, `<object>-<verb>ed`, the manifest lists each with its action, and `contract:diff` reports a new one. A code a flow writes on the toast itself (a warning of its own), or the frame lists on it, has its own row, even where a derivation gives the same code. The rule row is no code itself: the sources and consumers checks take a toast code the loader derived, never the row, and only the words of a derived toast code are written, in the frame's map.",
  ].join('\n\n'),
  keys: ['platform.toasts', 'screen.flow.states.<name>.invoke.toast'],
}

const destructiveQuestion: ReferenceRule = {
  id: 'destructive-question',
  title: 'The question before a destructive action',
  text: [
    "With a confirmation on the frame (an anchor of kind `confirmation`, `app-shell.confirmation`), every control whose binding names a destructive action asks it before the action runs: an action of the model whose verb is `delete`, an action of the platform whose verb (the first word of its last segment) is `ban`, `delete`, `remove` or `revoke`. The manifest writes it on the control, `asks: { dialog, code }`, the code `<object>-<verb>` for the model (`note.deleteNote` gives `note-delete`) or the platform action's name with `.` as `-` (`organisations.remove` gives `organisations-remove`); the confirmation carries every code asked with, which the vocabulary documents by one rule row, `<object>-<verb>`. Both are derived only: a screen file never writes `asks`, nor the frame the confirmation's codes.",
    "The flow says nothing of it: the press still leads to the state that runs the action, and the app's gate asks in front of the event, its confirm-button letting the event through and its cancel-button dropping it. The one line a screen writes is `confirm: false` on the control, which runs the action without asking; on a control that runs no destructive action it bans nothing and is refused. Without a confirmation on the frame nothing asks. The frame's confirmation is declared by the frame alone, once, reserved, with both answers and no action of its own.",
    "The key `asks` of a control, which the manifest carries. Derived: the control asks the frame's confirmation before its action runs, the action being destructive (a delete of the model; a ban, delete, remove or revoke of the platform). Enter in a field of the asking control's form asks the same way.",
    "On `anchors.<name>.confirm`: The control runs its destructive action without asking first. Left out, a control whose binding names a destructive action asks the frame's confirmation (an anchor of kind `confirmation` on the frame): an action of the model whose verb is `delete`, or an action of the platform whose verb (the first word of its last segment) is `ban`, `delete`, `remove` or `revoke`. On a control that runs no destructive action it bans nothing and is refused. Without a confirmation on the frame nothing asks. See the rule `destructive-question`.",
  ].join('\n\n'),
  keys: [
    'screen.anchors.<name>.confirm',
    'manifest.screens.anchors.<name>.asks',
    'manifest.ids.<name>.asks',
  ],
}

/** The rules of what a flow leaves out about the outcome of an action. */
export const OUTCOME_RULES: readonly ReferenceRule[] = [
  failureShow,
  requestOutcome,
  buttonRegion,
  successToast,
  destructiveQuestion,
]
