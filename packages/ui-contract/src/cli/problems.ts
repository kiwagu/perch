/** How the commands print the problems they find: one `file:line: message` per line, on stderr. */

import { type Contract, loadContract } from '../check'
import { formatProblem, type Problem } from '../files'

/** Prints the problems; whether there were any. */
export const reported = (problems: readonly Problem[]): boolean => {
  for (const problem of problems) {
    console.error(formatProblem(problem))
  }

  return problems.length > 0
}

/** The contract of the working tree, or undefined once its problems are printed. */
export function currentContract(root: string): Contract | undefined {
  const { contract, problems } = loadContract(root)

  reported(problems)

  return contract
}
