export {
  ACTORS,
  type Actor,
  type CommandHeader,
  parseCommandsFile,
  parseParams,
  parseShapeFile,
  type ShapeHeader,
} from './annotations'
export { type ModelOptions, type ModelResult, main, runModel } from './cli'
export {
  type Collected,
  type CommandEntry,
  type CommandFile,
  collect,
  type ShapeFile,
} from './collect'
export { type CompiledCommand, compileCommand } from './compile-command'
export {
  type ComponentBundle,
  emitModel,
  emitReplicaSchema,
  type GeneratedFile,
} from './emit-model'
export { emitPagesModel, emitSurrealkitSuites } from './emit-reports'
export { ModelingException } from './errors'
export { checkIdRegistry } from './id-registry'
export { idTypeOf, inferResultType, renderFieldType, tablesOf } from './infer-types'
export {
  type CrdtKind,
  loadSchemaModel,
  parseStructure,
  type RegionName,
  type SchemaModel,
  type SchemaResult,
  type StructureInfo,
  type TableModel,
} from './schema-structure'
export {
  type PathExpr,
  type PathStep,
  type Projection,
  parseShape,
  type ShapeAst,
  type ShapeSource,
} from './shape-dialect'
export {
  isKeyword,
  isPunct,
  statementCount,
  type Token,
  type TokenKind,
  tokenize,
} from './tokenizer'
export { type FieldType, parseTypeString, type ScalarName } from './type-string'

export const version = '0.1.0'
