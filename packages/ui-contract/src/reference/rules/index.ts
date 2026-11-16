import type { ReferenceRule } from '../rule'

import { INSTRUCTION_RULES } from './instructions'

export { INSTRUCTION_RULES } from './instructions'

/** Every rule of the engine that no key states, in the order the reference writes them. */
export const REFERENCE_RULES: readonly ReferenceRule[] = [...Object.values(INSTRUCTION_RULES)]
