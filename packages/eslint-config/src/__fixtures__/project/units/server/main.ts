import { alpha } from './alpha'
import { legacy } from './legacy/legacy'
import { root } from './wiring/root'

export const main = alpha + legacy + root
