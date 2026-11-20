/**
 * The field an error's code concerns, as the `fields` of the error in the contract say: `fields`
 * is the view's map of exactly the codes the contract places on a field of the screen, to that
 * field's key in the view; a code the map leaves out concerns the form, and none while no error
 * shows. A view marks a field as `concerns === '<key>'`, on the field and on its control.
 */
export function concernsOf<Code extends string, Key extends string>(
  fields: Partial<Record<Code, Key>>,
  code: Code | undefined,
): Key | undefined {
  return code === undefined ? undefined : fields[code]
}
