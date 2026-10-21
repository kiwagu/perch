/**
 * JSON Schema 2020-12 through Ajv: meta-validation of a schema the contract carries (the
 * model, a route's parameters) and validation of data against a schema (the manifest).
 * `x-perch` is the contract's own keyword, so strict mode accepts it.
 */

import { Ajv2020, type ErrorObject } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import type { Problem } from './problems'

export const createValidator = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: true })

  addFormats(ajv)
  ajv.addKeyword('x-perch')

  return ajv
}

const problemsOf = (file: string, errors: ErrorObject[] | null | undefined): Problem[] =>
  (errors ?? []).map((error) => ({
    file,
    message: `${error.instancePath || '/'}: ${error.message ?? error.keyword}`,
  }))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Whether `schema` is a valid JSON Schema 2020-12 document (the meta-schema). */
export function jsonSchemaProblems(file: string, schema: unknown): Problem[] {
  if (typeof schema !== 'object' || schema === null) {
    return [{ file, message: 'a JSON Schema is an object' }]
  }

  const ajv = createValidator()

  try {
    return ajv.validateSchema(schema) === true ? [] : problemsOf(file, ajv.errors)
  } catch (error) {
    return [{ file, message: messageOf(error) }]
  }
}

/** Whether `data` matches `schema`. */
export function validateAgainst(file: string, schema: object, data: unknown): Problem[] {
  try {
    const validate = createValidator().compile(schema)

    return validate(data) ? [] : problemsOf(file, validate.errors)
  } catch (error) {
    return [{ file, message: `the schema does not compile: ${messageOf(error)}` }]
  }
}
