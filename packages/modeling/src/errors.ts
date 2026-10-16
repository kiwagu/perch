import { ExceptionBase } from '@workspace/kernel'

/** A `.surql` file outside the declared dialect; the CLI reports it as a modeling problem. */
export class ModelingException extends ExceptionBase {
  readonly code = 'modeling:INVALID_SURQL'
}
