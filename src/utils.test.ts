import { expect, test } from 'vitest'

import { extractPath, toArgs, toFlagCase } from './utils.js'

test.each([
  ['', { id: undefined, path: '/' }],
  ['/', { id: undefined, path: '/' }],
  ['/1', { id: 1, path: '/' }],
  ['/1/', { id: 1, path: '/' }],
  ['/-3', { id: undefined, path: '/-3' }],
  ['/123/foo', { id: 123, path: '/foo' }],
  ['/123456/bar', { id: 123456, path: '/bar' }],
  ['/-5/baz', { id: undefined, path: '/-5/baz' }],
  ['/321/foo/bar', { id: 321, path: '/foo/bar' }],
  ['/567/foo/bar/baz', { id: 567, path: '/foo/bar/baz' }],
  ['/321/foo/bar/', { id: 321, path: '/foo/bar' }],
  ['/foo', { id: undefined, path: '/foo' }],
  ['/foo/bar', { id: undefined, path: '/foo/bar' }],
])('extractPath("%s") -> %o', (input, expected) => {
  expect(extractPath(input)).toEqual(expected)
})

test.each([
  [[{}], []],
  [[{ foo: undefined }], []],
  [[{ foo: false }], ['--foo', 'false']],
  [[{ foo: true }], ['--foo']],
  [[{ foo: '' }], ['--foo']],
  [[{ foo: 'bar' }], ['--foo', 'bar']],
  [[{ foo: 0 }], ['--foo', '0']],
  [[{ foo: 1 }], ['--foo', '1']],
  [[{ foo: 1n }], ['--foo', '1']],
  [[{ foo: 'bar', baz: 1 }], ['--foo', 'bar', '--baz', '1']],
  [[{ fooBar: 'test' }], ['--foo-bar', 'test']],
  [[{ foo: ['bar', 'baz'] }], ['--foo', 'bar,baz']],
  [[{ foo: { barBaz: 'test' } }], ['--foo.bar-baz', 'test']],
  [[{ foo: { barBaz: ['test', 'test2'] } }], ['--foo.bar-baz', 'test,test2']],
  [
    [{ fooBar: 'test' }, { casing: 'snake' }],
    ['--foo_bar', 'test'],
  ],
  [
    [{ foo: { barBaz: 'test' } }, { casing: 'snake' }],
    ['--foo.bar_baz', 'test'],
  ],
] as [Parameters<typeof toArgs>, string[]][])(
  'toArgs(%o) -> %o',
  ([input, options], expected) => {
    expect(toArgs(input, options)).toEqual(expected)
  },
)

test.each([
  ['foo', '--foo'],
  ['Foo', '--foo'],
  ['fooBar', '--foo-bar'],
  ['fooBarBaz', '--foo-bar-baz'],
  ['foo.BarBaz', '--foo.bar-baz'],
])('toFlagCase(%s) -> %s', (input, expected) => {
  expect(toFlagCase(input)).toBe(expected)
})
