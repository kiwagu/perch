/**
 * The budget of the descriptions: every description written in the files of `contract/domain`
 * (`readDescriptions`) keeps `DESCRIPTION_BUDGET` characters, whatever it describes, a screen's
 * own included. One past it is a problem at its line, naming its place and its length, with the
 * purpose of its field: the text its schema describes the field with, which an editor shows too.
 */

import { jsonPath, type Problem } from '../files'
import { DESCRIPTION_BUDGET, DESCRIPTION_PURPOSES, descriptionLength } from '../schemas'

import { type Contract, inFile } from './contract'

export function descriptionsProblems(contract: Contract): Problem[] {
  return contract.descriptions.flatMap(({ file, line, at, kind, place, text }) => {
    const length = descriptionLength(text)

    return length > DESCRIPTION_BUDGET
      ? [
          inFile(
            file,
            `${jsonPath(at)}: the description of ${place} is ${length} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${DESCRIPTION_PURPOSES[kind]}"`,
            line,
          ),
        ]
      : []
  })
}
