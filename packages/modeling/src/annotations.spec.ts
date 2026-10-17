import { describe, expect, it } from 'vitest'

import { parseCommandsFile, parseShapeFile } from './annotations'

describe('parseShapeFile', () => {
  it('reads @params and leaves the SELECT body', () => {
    const text = '-- @params $id: record<identity>, $limit: int\nSELECT name FROM ONLY $id;\n'
    const { header, body } = parseShapeFile(text)

    expect(header).toEqual({
      kind: 'shape',
      params: [
        { name: 'id', type: 'record<identity>' },
        { name: 'limit', type: 'int' },
      ],
      server: false,
    })
    expect(body.trim()).toBe('SELECT name FROM ONLY $id;')
  })

  it('keeps commas inside generic parameter types', () => {
    const { header } = parseShapeFile(
      '-- @params $ids: array<record<identity | org>, 10>, $x: string\nSELECT name FROM $ids;',
    )

    expect(header.params).toEqual([
      { name: 'ids', type: 'array<record<identity | org>, 10>' },
      { name: 'x', type: 'string' },
    ])
  })

  it('reads @tables and @server', () => {
    const { header } = parseShapeFile(
      '-- @params\n-- @tables a, b\n-- @server\nSELECT name FROM identity;',
    )

    expect(header).toMatchObject({ tables: ['a', 'b'], server: true })
  })

  it('rejects a shape without @params when $vars are used', () => {
    expect(() => parseShapeFile('SELECT * FROM ONLY $id;')).toThrow(/undeclared parameter \$id/)
  })

  it('allows the built-in session parameters', () => {
    expect(() => parseShapeFile('SELECT name FROM identity WHERE id = $auth.id;')).not.toThrow()
  })

  it('rejects more than one statement', () => {
    expect(() => parseShapeFile('-- @params\nSELECT * FROM identity; SELECT * FROM org;')).toThrow(
      /single statement/,
    )
  })

  it('does not split on a semicolon inside a string', () => {
    expect(() => parseShapeFile("SELECT name FROM identity WHERE name = 'a;b';")).not.toThrow()
  })
})

describe('parseCommandsFile', () => {
  it('splits commands by @command and reads allow/deny', () => {
    const text = [
      '-- @command updateName($id: record<identity>, $name: string)',
      '-- @allow record',
      'UPDATE $id SET name = $name;',
      '',
      '-- @command deleteAccount($id: record<identity>)',
      '-- @allow record',
      '-- @deny guest',
      'DELETE $id;',
    ].join('\n')
    const commands = parseCommandsFile(text)

    expect(commands.map((command) => command.header.name)).toEqual(['updateName', 'deleteAccount'])
    expect(commands[0]?.header.params).toEqual([
      { name: 'id', type: 'record<identity>' },
      { name: 'name', type: 'string' },
    ])
    expect(commands[0]?.header.allow).toEqual(['record'])
    expect(commands[1]?.header.deny).toEqual(['guest'])
    expect(commands[1]?.body.trim()).toBe('DELETE $id;')
  })

  it('rejects an unknown actor', () => {
    expect(() =>
      parseCommandsFile('-- @command x($id: record<identity>)\n-- @allow robots\nDELETE $id;'),
    ).toThrow(/unknown actor robots/)
  })

  it('rejects text before the first @command', () => {
    expect(() => parseCommandsFile('DELETE identity;\n-- @command x()\nDELETE identity;')).toThrow(
      /@command header/,
    )
  })
})
