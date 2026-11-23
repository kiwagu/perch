/**
 * What each written description of the contract is for, by the place it describes, and the
 * one budget every one of them keeps. Each text is the `.describe()` of its field in the
 * schemas, so the generated JSON Schemas show it as an editor's hint, and the purpose the
 * budget problem of `contract:check` quotes: one source for both. A description says what its
 * element is for; what the structure, another element, the platform, the model, the vocabulary
 * or the flow already says is left to them.
 */

/**
 * The most characters a written description may have, whatever it describes; a field hint the
 * engine writes into the schemas keeps the same budget (`hintBudgetProblems`).
 */
export const DESCRIPTION_BUDGET = 200

const AT_MOST = `At most ${DESCRIPTION_BUDGET} characters.`

export const DESCRIPTION_PURPOSES = {
  screen: `What the screen is for: the task it serves and when it is shown. Not a list of its parts: each anchor has its own description. See the rule \`description-purposes\`. ${AT_MOST}`,
  anchor: `What the element is for. Its kind, binding, codes, states, roles and flow say the rest; leave out what the engine says itself. See the rule \`description-purposes\`. ${AT_MOST}`,
  containerState: `What is visible on the screen in this container state; the vocabulary says what the state means, and each anchor what it is for in a description of its own. ${AT_MOST}`,
  flow: `What the flow does as a whole that no single state says: how its areas or its modes go together. Its states, events, guards and effects say the rest. ${AT_MOST}`,
  state: `What a tester or a user tells apart in the state that its events, effects and \`meta.renders\` do not say. ${AT_MOST}`,
  region: `What area of the screen the region is. Its states and their transitions say how it behaves. ${AT_MOST}`,
  transition: `What follows that the target, the guard and the effects do not say: where a success leads, what a failure shows, what restarts what. ${AT_MOST}`,
  guard: `What the guard holds, in one sentence the app implements; a guard that tells the failures of an action apart takes their codes, \`{ codes }\`, instead. ${AT_MOST}`,
  activityGuard: `What the guard holds, in one sentence the app implements. ${AT_MOST}`,
  parameter: `What the route parameter means. Its type, bounds, default and examples say the rest. ${AT_MOST}`,
  action: `What the platform action does. What holds once it succeeds is its \`result\`, and its parameters, codes, roles and mail say the rest. ${AT_MOST}`,
  actionParameter: `What the parameter is for. Its type or the value it refers to, and its constraints, are written beside it. ${AT_MOST}`,
  value: `What the value holds, for every parameter that refers to it. ${AT_MOST}`,
  event: `What the event means: when the platform raises it. What follows is said by the flows that handle it. ${AT_MOST}`,
  composite: `What the composite is for: the list it derives on a screen carries it, and each item has a description of its own. ${AT_MOST}`,
  compositeItem: `What the item of the composite's list says: every screen that opts in derives an item anchor with it as its description, and the composite's \`itemState\` marks it. ${AT_MOST}`,
  model: `What the model holds, and what it leaves to the platform. Each entity, field and action has a description of its own. ${AT_MOST}`,
  entity: `What the entity is. Its fields and actions have descriptions of their own, and \`x-perch\` says where it lives and who may change it. ${AT_MOST}`,
  field: `What the field holds. Its type, its constraints and \`x-perch\` say the rest, and the failure codes they give are derived. ${AT_MOST}`,
  modelAction: `What the action does. Its params say which fields it sets, and what it fails with is derived from them. ${AT_MOST}`,
  activity: `What the activity is for: the task it serves across its screens. Its states are the visits, and the screens do the work. ${AT_MOST}`,
  activityData: `What the activity carries from screen to screen; \`model\` names the field of the model it is. ${AT_MOST}`,
  visit: `What the visit is for in the task. Its \`meta\` names the screen and the address, and the screen has a description of its own. ${AT_MOST}`,
  activityTransition: `What acting on the anchor leads to that the target and the guard do not say; the flows of the screens do the work. ${AT_MOST}`,
} as const

/**
 * What each text of a platform action's behaviour is for: its outcome lines, the condition each of
 * its codes answers on, and the rule of an invariant. They are behaviour, which the hand-over diff
 * lists with their text, not descriptions, and keep the same budget (`behaviourTextsProblems`).
 */
export const BEHAVIOUR_PURPOSES = {
  outcome: `One outcome of the action: the plain success first, then each other outcome under its condition. A refusal is said by its code's condition. ${AT_MOST}`,
  condition: `When the action answers with the code, as the server judges it. A rule several actions keep is an invariant, named under the code with or instead of it. ${AT_MOST}`,
  rule: `The rule, said once for every action that names it under the code it refuses with. ${AT_MOST}`,
} as const

/** What a text of a platform action's behaviour is: an outcome line, a condition or a rule. */
export type BehaviourKind = keyof typeof BEHAVIOUR_PURPOSES

/** What a written description describes: the field whose purpose it keeps. */
export type DescriptionKind = keyof typeof DESCRIPTION_PURPOSES

/** The length of a description as its budget counts it, in characters. */
export const descriptionLength = (text: string): number => [...text].length
