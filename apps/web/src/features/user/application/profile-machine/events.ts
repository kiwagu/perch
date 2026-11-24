/** The events of the screen's flow: the anchors acted on, and the stored fields that changed. */
export type ProfileEvent =
  | { readonly type: 'user.profile.name-input' }
  | { readonly type: 'user.profile.bio-textarea' }
  | { readonly type: 'model.profile.name' }
  | { readonly type: 'model.profile.bio' }
  | { readonly type: 'user.profile.save-button' }
  | { readonly type: 'user.profile.sign-out-button' }
  | { readonly type: 'user.profile.sign-out-dialog.confirm-button' }
  | { readonly type: 'user.profile.sign-out-dialog.cancel-button' }

/** The params of the flow's effects: an anchor shows one of the codes; the app moves to a path. */
export interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

export interface NavigateParams {
  readonly to: string
}

/** What the machine asks of its host: a code shown outside the form, a move to a path. */
export type ProfileEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'navigate' } & NavigateParams)
