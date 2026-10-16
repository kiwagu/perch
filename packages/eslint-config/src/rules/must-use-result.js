/**
 * Reports an expression statement whose value is a neverthrow `Result` or
 * `ResultAsync`. A dropped Result is a dropped error: the caller must match,
 * map, return or assign it. Needs type information (typescript-eslint
 * `projectService`); without it the rule stays silent.
 */

const RESULT_TYPES = new Set(['Ok', 'Err', 'ResultAsync'])

/** @param {import('typescript').Type} type */
function constituents(type) {
  return type.isUnion() ? type.types : [type]
}

/** @param {import('typescript').Type} type */
function isResult(type) {
  return constituents(type).some((part) => {
    const symbol = part.getSymbol() ?? part.aliasSymbol

    if (!symbol || !RESULT_TYPES.has(symbol.getName())) {
      return false
    }

    return (symbol.getDeclarations() ?? []).some((declaration) =>
      declaration.getSourceFile().fileName.includes('neverthrow'),
    )
  })
}

/** @type {import('eslint').Rule.RuleModule} */
export const mustUseResult = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow discarding a neverthrow Result or ResultAsync',
    },
    messages: {
      unused:
        'This Result is discarded. Match, map, return or assign it so the error path is handled.',
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices

    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      return {}
    }

    const checker = services.program.getTypeChecker()

    return {
      ExpressionStatement(node) {
        const tsNode = services.esTreeNodeToTSNodeMap.get(node.expression)

        if (isResult(checker.getTypeAtLocation(tsNode))) {
          context.report({ node, messageId: 'unused' })
        }
      },
    }
  },
}
