import base from '@workspace/eslint-config'

/**
 * Files that still hold two classes and are being split in a change of their own. An entry
 * leaves this list in the change that splits its file; no entry is ever added.
 */
const pendingClassSplits = ['packages/replica/src/region-doc.ts']

export default [...base, { files: pendingClassSplits, rules: { 'max-classes-per-file': 'off' } }]
