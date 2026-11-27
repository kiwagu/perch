import { describe, expect, it } from 'vitest'

import { findSurqlRoles } from './surql-roles'

const ROLES = new Set(['admin', 'guest', 'identity', 'member', 'operator'])
const ALLOWED = new Map([['identity.role', new Set(['user'])]])

const found = (source: string) =>
  findSurqlRoles('x.surql', source, ROLES, ALLOWED).map(({ line, text }) => `${line}: ${text}`)

describe('findSurqlRoles', () => {
  it('passes the roles of the contract wherever SurrealQL writes a role', () => {
    expect(
      found(`DEFINE FIELD OVERWRITE role ON membership TYPE string
  ASSERT $value IN ['member', "admin"];
CREATE member SET role = 'admin';
SELECT * FROM membership WHERE role = 'admin' AND role != 'member';
UPDATE membership SET role = $role WHERE role IN ['admin'];
CREATE invitation CONTENT { role: 'member', email: $email };
SELECT VALUE id FROM type::record('member', $id);
-- role = 'nobody' in a comment
`),
    ).toEqual([])
  })
  it('refuses a value in a role position that the contract does not name, at its line', () => {
    expect(
      found(`DEFINE FIELD role ON TABLE membership TYPE string
  ASSERT $value IN ['member', 'admni'];
SELECT * FROM membership
  WHERE role == "owner";
CREATE invitation CONTENT { role: 'boss' };
UPDATE membership SET role = 'chief';
`),
    ).toEqual(['2: admni', '4: owner', '5: boss', '6: chief'])
  })
  it('takes a value allowed for one field of one table there alone', () => {
    expect(
      found(`DEFINE FIELD OVERWRITE role ON identity TYPE option<string>
  ASSERT $value = NONE
  OR $value IN ['user', 'operator'];
DEFINE FIELD OVERWRITE role ON membership TYPE string ASSERT $value = 'user';
UPDATE identity SET role = 'user';
`),
    ).toEqual(['4: user', '5: user'])
  })
  it('reads $value as a role only in the definition of a field named role', () => {
    expect(
      found(`DEFINE FIELD OVERWRITE locale ON identity TYPE string ASSERT $value IN ['en', 'es'];
DEFINE FIELD OVERWRITE kind ON note TYPE string ASSERT $value = 'memo';
`),
    ).toEqual([])
  })
})
