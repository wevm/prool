import { expect, test } from 'vitest'

import { toArgs, toFlagCase } from './utils.js'

test.each([
  [{}, []],
  [{ foo: undefined }, []],
  [{ foo: false }, []],
  [{ foo: true }, ['--foo']],
  [{ foo: '' }, ['--foo']],
  [{ foo: 'bar' }, ['--foo', 'bar']],
  [{ foo: 0 }, ['--foo', '0']],
  [{ foo: 1 }, ['--foo', '1']],
  [{ foo: 1n }, ['--foo', '1']],
  [{ foo: 'bar', baz: 1 }, ['--foo', 'bar', '--baz', '1']],
])('toArgs(%o) -> %o', (input, expected) => {
  expect(toArgs(input)).toEqual(expected)
})

test.each([
  ['foo', '--foo'],
  ['fooBar', '--foo-bar'],
  ['fooBarBaz', '--foo-bar-baz'],
])('toFlagCase(%s) -> %s', (input, expected) => {
  expect(toFlagCase(input)).toBe(expected)
})
