/** The shape dialect: one SELECT a shape is written in, parsed so its result type and reads can be derived. */

export type { PathExpr, PathStep, Projection, ShapeAst, ShapeSource, TailPath } from './ast'
export { parseShape } from './parse'
