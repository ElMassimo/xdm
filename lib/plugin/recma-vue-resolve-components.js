import { walk } from 'estree-walker'

/**
 * @typedef {import('estree-jsx').Node} Node
 * @typedef {import('estree-jsx').Statement} Statement
 * @typedef {import('estree-jsx').FunctionDeclaration} FunctionDeclaration
 * @typedef {import('estree-jsx').Program} Program
 */

/**
 * A plugin to build JSX into Vue createVNode function calls.
 *
 * @type {import('unified').Plugin<[], Program>}
 */
export function recmaVueResolveComponents() {
  return (tree) => resolveMissingComponents(tree)
}

/**
 * @template {Program} T
 * @param {T} tree
 * @returns {T}
 */
export function resolveMissingComponents(tree) {
  walk(tree, {
    // @ts-expect-error: types are wrong.
    enter(/** @type {Node} */ node) {
      if (node.type === 'Program')
        return

      if (node.type === 'ImportDeclaration') {
        const importSource = node.source?.value
        if (typeof importSource === 'string' && importSource.endsWith('jsx-runtime'))
          node.specifiers.push({
            type: 'ImportSpecifier',
            imported: { type: 'Identifier', name: 'resolveComponent' },
            local: { type: 'Identifier', name: '_resolveComponent' },
          })
        return this.skip()
      }

      if (node.type !== 'FunctionDeclaration')
        return this.skip()

      if (node.id?.name === 'MDXContent') {
        /** @type {FunctionDeclaration|undefined} */
        // @ts-ignore
        const createMdxContent = node.body.body
          .find(s => s.type === 'FunctionDeclaration' && s.id?.name === '_createMdxContent')

        if (createMdxContent)
          rewriteMdxContentComponents(createMdxContent.body.body)

        return this.skip()
      }
      else if (node.id?.name === '_missingMdxReference') {
        return this.remove()
      }
    },
  })

  return tree
}

/**
 * Converts all _missingMdxReference assertions into _resolveComponent assignments.
 *
 * @param {Statement[]} statements
 */
function rewriteMdxContentComponents(statements) {
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]

    // Allow reassigning the component identifiers when they are globally resolved.
    if (statement.type === 'VariableDeclaration') {
      statement.kind = 'let'
      continue
    }

    // Walk through the assertions that detect missing components.
    if (
      statement.type === 'IfStatement'
      && statement.test.type === 'UnaryExpression'
      && statement.test.argument.type === 'Identifier'
      && statement.consequent.type === 'ExpressionStatement'
    ) {
      const missingReferenceCall = statement.consequent.expression

      if (
        missingReferenceCall.type === 'CallExpression'
        && missingReferenceCall.callee.type === 'Identifier'
      ) {
        // Replace _missingMdxReference with _resolveComponents
        missingReferenceCall.callee.name = '_resolveComponent'

        // Remove second argument to allow unplugin-vue-components to statically
        // replace the method call with a resolved component.
        missingReferenceCall.arguments.splice(1, 1)

        statement.consequent.expression = {
          type: 'AssignmentExpression',
          operator: '=',
          left: statement.test.argument,
          right: statement.consequent.expression,
        }
      }

      continue
    }

    // Optimization: assume all missing component checks are at the beginning.
    break
  }
}
