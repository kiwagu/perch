/** The rules of what a state renders: the lists of `meta.renders`, what rendered means, who reads it. */

import type { ReferenceRule } from '../rule'

const stateRenders: ReferenceRule = {
  id: 'renders',
  title: 'What a state renders',
  text: [
    "An anchor that only some states render, those states list in `meta.renders`: a plain state of the root, a parallel state or a state of a region. An anchor no state of the flow lists is rendered in every state. An anchor a state lists is rendered only where it is listed: in a plain state of the root that lists it, and in a state of a region that lists it or whose parallel state does. A name is an anchor its screen declares, listed once; a derived part is rendered with its base, so a state lists the base (`user.sign-in.password-input`, never its `visibility-button`). A listed anchor also renders the anchors declared under it (`<anchor>.<rest>`, as a scenario's codes and states speak of them): `user.sign-in.password-rule-list` brings the six items of the composite with it, so a state lists the list alone, never the list and one of its items in one list, and an anchor declared under a listed one is rendered only where its container is, or where a state lists it itself.",
    "A plain state of the root or a state of a region that handles an event on an anchor only some states render renders that anchor (for an event on a derived part or on an anchor declared under another, through the anchor it is under), since a control the user acts on is on the page; a state may render a control it does not handle, which is then disabled. The events of a parallel state's own `on` are not held to this, and neither are the effects: a `show` or a `clear` may name an anchor its state does not render. The states of a region written by its pattern or by its button, or derived by the loader, list nothing: an area that renders something in some of its states only is written in full. For the modes of the sign-in screen (the rest of its flow left out):",
    [
      '```yaml',
      'flow:',
      '  initial: sign-in',
      '  states:',
      '    sign-in:',
      '      meta:',
      '        renders: [ user.sign-in.forgot-link ]',
      '    sign-up:',
      '      meta:',
      '        renders: [ user.sign-in.password-rule-list, user.sign-in.password-confirmation-input, user.sign-in.name-input ]',
      '    check-mail:',
      '      meta:',
      '        renders: [ user.sign-in.forgot-link, user.sign-in.resend-button ]',
      '    # signing-in as sign-in; password-weak, passwords-differ and signing-up as sign-up;',
      '    # unverified and resending as check-mail',
      '```',
    ].join('\n'),
    'The form, the email and password inputs and the submit and toggle buttons are listed by no state, so every state renders them; the forgot link is rendered only in the states that list it, and the password rule list with its items only in the states of the mode sign-up. `passwords-differ` handles `user.sign-in.password-confirmation-input`; without its list, `contract:check` would say `"user.sign-in.password-confirmation-input" is handled here but not rendered: only the states that list it in meta.renders render it`. A state that runs an action lists what stays on the page while it runs: `signing-up` lists the rule list, the confirmation and the name input, or they would go while the account is created. `contract:diff` lists each entry as a line `<state path> renders <anchor>`.',
    "Rendered means visible to the user. An anchor a state renders is on the page and seen; one it does not render is not seen: absent from the page, or kept in it hidden (`hidden`, `display: none` or `visibility: hidden`, as the page helper's `visible` reads it), as a form that keeps what was typed into it while it is closed. The app reads what a state renders from its machine, whose states carry the flow's `meta.renders`, through the engine's `renderedAt` and `isRendered` (`@workspace/ui-contract/anchors`; `isListed` says whether an anchor is rendered only where listed, and `listedBy(state)` is how all of them read one state's list), never from a flag of its own, as it reads which controls are enabled; the engine's comparison holds those lists to the flow's, and an e2e run holds the page to them in every settled state a test passes through (see the rule `settled-state`).",
    "`contract:check` holds `meta.renders`: it lists anchors its own screen declares (a derived part's base, never the part), each once and never beside an anchor it is declared under, and a plain state of the root or a state of a region renders every anchor only some states render that it handles (one declared under a listed anchor, through that anchor).",
  ].join('\n\n'),
  keys: [
    'screen.flow.states.<name>.meta.renders',
    'screen.flow.states.<name>.states.<name>.states.<name>.meta.renders',
  ],
}

/** The rules of what a state renders. */
export const RENDER_RULES: readonly ReferenceRule[] = [stateRenders]
